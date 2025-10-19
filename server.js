const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GridFSBucket } = require('mongodb');

require('dotenv').config();

const app = express();

// ✅ Middlewares
app.use(cors());
app.use(express.json());

// ✅ CONFIGURAÇÕES
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'ipb_jwt_secret_2024';
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

let isDBConnected = false;
let gridFSBucket;

// ✅ CONFIGURAÇÃO DO MULTER PARA UPLOAD TEMPORÁRIO
const upload = multer({
  dest: 'temp_uploads/', // Pasta temporária
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limite
  },
  fileFilter: (req, file, cb) => {
    // ✅ Validar apenas imagens
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens são permitidas!'), false);
    }
  }
});

// ✅ Criar pasta temporária se não existir
const tempDir = 'temp_uploads/';
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// ✅ MODELO DE USUÁRIO
const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  username: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true
  },
  password: { 
    type: String, 
    required: true 
  },
  role: { 
    type: String, 
    enum: ['admin', 'editor', 'viewer'], 
    default: 'viewer' 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  lastLogin: { 
    type: Date 
  }
}, { 
  timestamps: true 
});

// ✅ MIDDLEWARE PARA HASH DA SENHA
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// ✅ MÉTODO PARA COMPARAR SENHA
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// ✅ MÉTODO PARA DADOS PÚBLICOS
userSchema.methods.toPublicJSON = function() {
  return {
    _id: this._id,
    name: this.name,
    username: this.username,
    role: this.role,
    isActive: this.isActive,
    lastLogin: this.lastLogin,
    createdAt: this.createdAt
  };
};

const User = mongoose.model('User', userSchema);

// ✅ MODELO DE POST
const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  text: { type: String, required: true },
  category: { 
    type: String, 
    required: true,
    enum: ['Eventos', 'SAF', 'Ensaios', 'Visitas', 'Clube do Livro', 'Aniversariantes']
  },
  images: [{ type: String }], // Agora serão URLs como: /api/images/IMAGE_ID
  date: { type: Date, required: true },
  author: { type: String, default: 'Admin' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// ✅ MIDDLEWARE PARA GARANTIR QUE IMAGES SEJA ARRAY
postSchema.pre('save', function(next) {
  if (this.images && !Array.isArray(this.images)) {
    this.images = [this.images];
  }
  next();
});

// ✅ MÉTODO PARA LIMPEZA DE IMAGENS ORFÃS NO GRIDFS
postSchema.statics.cleanupOrphanedImages = async function() {
  try {
    if (!gridFSBucket) return;
    
    // Buscar todas as imagens usadas nos posts
    const usedImages = await this.distinct('images');
    
    // Extrair IDs das imagens das URLs
    const usedImageIds = usedImages.map(url => {
      const match = url.match(/\/api\/images\/([a-f0-9]{24})/);
      return match ? match[1] : null;
    }).filter(id => id).map(id => new mongoose.Types.ObjectId(id));
    
    // Buscar todas as imagens no GridFS
    const allImages = await gridFSBucket.find().toArray();
    
    // Deletar imagens não usadas
    for (const image of allImages) {
      if (!usedImageIds.some(usedId => usedId.equals(image._id))) {
        await gridFSBucket.delete(image._id);
        console.log('🧹 Imagem órfã removida do GridFS:', image.filename);
      }
    }
  } catch (error) {
    console.error('❌ Erro na limpeza do GridFS:', error);
  }
};

const Post = mongoose.model('Post', postSchema);

const connectDB = async () => {
  try {
    console.log('🔗 Conectando ao MongoDB...');
    
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI não definida');
    }
    
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
    });
    
    isDBConnected = true;
    console.log('✅ MongoDB CONECTADO!');
    
    // ✅ CONFIGURAR GRIDFS BUCKET
    gridFSBucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'posts_images'
    });
    console.log('✅ GridFS Bucket configurado!');
    
    // ✅ CRIA USUÁRIOS INICIAIS
    await createInitialUsers();
    
  } catch (error) {
    console.error('❌ Erro MongoDB:', error.message);
    isDBConnected = false;
    setTimeout(connectDB, 10000);
  }
};

// ✅ MIDDLEWARE DE AUTENTICAÇÃO JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    req.user = user;
    next();
  });
};

// ✅ MIDDLEWARE PARA VERIFICAR PERMISSÕES
const requireAdminOrEditor = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'editor')) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores e editores.' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }
  next();
};

// ✅ FUNÇÃO PARA CRIAR USUÁRIOS INICIAIS
const createInitialUsers = async () => {
  try {
    const initialUsers = [
      { name: 'Almir', username: 'almir', password: '1515', role: 'admin' },
      { name: 'Franklin', username: 'franklin', password: '1212', role: 'admin' },
      { name: 'Marcio', username: 'marcio', password: '1010', role: 'admin' },
      { name: 'Milena', username: 'milena', password: '1111', role: 'admin' },
      { name: 'Sabrina', username: 'sabrina', password: '2020', role: 'admin' },
      { name: 'Visitante', username: 'visitante', password: '0000', role: 'viewer' }
    ];

    for (const userData of initialUsers) {
      const existingUser = await User.findOne({ username: userData.username });
      
      if (!existingUser) {
        const user = new User(userData);
        await user.save();
        console.log(`✅ Usuário criado: ${userData.name} (${userData.role})`);
      } else {
        console.log(`⚠️ Usuário já existe: ${userData.name}`);
      }
    }
    
    console.log('🎉 Sistema de usuários pronto!');
    
  } catch (error) {
    console.error('❌ Erro ao criar usuários:', error);
  }
};

// ✅ ROTAS DE AUTENTICAÇÃO

// LOGIN COM CREDENCIAIS
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const cleanUsername = username?.trim().toLowerCase() || '';
    const cleanPassword = password?.trim() || '';
    
    console.log('🔐 Tentativa de login:', cleanUsername);
    
    // Buscar usuário
    const user = await User.findOne({ 
      username: cleanUsername, 
      isActive: true 
    });
    
    if (!user) {
      console.warn('❌ Usuário não encontrado:', cleanUsername);
      return res.status(401).json({ 
        success: false, 
        error: 'Credenciais inválidas' 
      });
    }
    
    // Verificar senha
    const isPasswordValid = await user.comparePassword(cleanPassword);
    
    if (!isPasswordValid) {
      console.warn('❌ Senha inválida para:', cleanUsername);
      return res.status(401).json({ 
        success: false, 
        error: 'Credenciais inválidas' 
      });
    }
    
    // Atualizar último login
    user.lastLogin = new Date();
    await user.save();
    
    // Gerar JWT Token
    const token = jwt.sign(
      { 
        userId: user._id.toString(),
        username: user.username, 
        name: user.name, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    console.log(`✅ Login bem-sucedido: ${user.name} (${user.role})`);
    
    res.json({
      success: true,
      message: 'Login realizado com sucesso!',
      user: user.toPublicJSON(),
      token: token
    });
    
  } catch (error) {
    console.error('💥 Erro no login:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// ✅ VERIFICAR TOKEN (para login automático)
app.get('/api/auth/verify', authenticateToken, async (req, res) => {
  try {
    // Buscar usuário atualizado
    const user = await User.findById(req.user.userId);
    
    if (!user || !user.isActive) {
      return res.status(401).json({ 
        success: false, 
        error: 'Usuário não encontrado ou inativo' 
      });
    }
    
    res.json({
      success: true,
      user: user.toPublicJSON()
    });
    
  } catch (error) {
    console.error('❌ Erro ao verificar token:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao verificar token' 
    });
  }
});

// ✅ ROTAS DE UPLOAD DE IMAGENS COM GRIDFS

// UPLOAD DE IMAGEM ÚNICA
app.post('/api/upload', authenticateToken, requireAdminOrEditor, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhuma imagem enviada' 
      });
    }

    // ✅ Criar stream de leitura do arquivo
    const readStream = fs.createReadStream(req.file.path);
    
    // ✅ Nome único para o arquivo
    const filename = `post_${Date.now()}_${req.file.originalname}`;
    
    // ✅ Upload para GridFS
    const uploadStream = gridFSBucket.openUploadStream(filename, {
      metadata: {
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        uploadedBy: req.user.userId,
        uploadedAt: new Date()
      }
    });

    // ✅ Pipe do arquivo para o GridFS
    readStream.pipe(uploadStream);

    uploadStream.on('error', (error) => {
      console.error('❌ Erro no upload GridFS:', error);
      fs.unlinkSync(req.file.path); // Limpar arquivo temporário
      res.status(500).json({ 
        success: false, 
        error: 'Erro no upload da imagem' 
      });
    });

    uploadStream.on('finish', () => {
      // ✅ Deletar arquivo temporário
      fs.unlinkSync(req.file.path);
      
      // ✅ URL para acessar a imagem
      const imageUrl = `/api/images/${uploadStream.id}`;
      
      console.log('✅ Upload GridFS realizado:', filename);
      
      res.json({ 
        success: true, 
        imageUrl: `${BASE_URL}${imageUrl}`,
        imageId: uploadStream.id.toString(),
        filename: filename,
        message: 'Upload realizado com sucesso' 
      });
    });

  } catch (error) {
    console.error('❌ Erro no upload:', error);
    
    // ✅ Limpar arquivo temporário em caso de erro
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Erro no upload da imagem' 
    });
  }
});

// UPLOAD MÚLTIPLO DE IMAGENS
app.post('/api/upload-multiple', authenticateToken, requireAdminOrEditor, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhuma imagem enviada' 
      });
    }
    
    const imageUrls = [];
    
    // ✅ Upload de cada imagem para GridFS
    for (const file of req.files) {
      try {
        const readStream = fs.createReadStream(file.path);
        const filename = `post_${Date.now()}_${file.originalname}`;
        
        const uploadStream = gridFSBucket.openUploadStream(filename, {
          metadata: {
            originalName: file.originalname,
            mimetype: file.mimetype,
            uploadedBy: req.user.userId,
            uploadedAt: new Date()
          }
        });

        await new Promise((resolve, reject) => {
          readStream.pipe(uploadStream);
          
          uploadStream.on('finish', () => {
            const imageUrl = `/api/images/${uploadStream.id}`;
            imageUrls.push(`${BASE_URL}${imageUrl}`);
            fs.unlinkSync(file.path); // Limpar arquivo temporário
            resolve();
          });
          
          uploadStream.on('error', reject);
        });
        
      } catch (fileError) {
        console.error('❌ Erro no upload de um arquivo:', fileError);
        // Continuar com outros arquivos
      }
    }

    console.log('✅ Upload múltiplo GridFS realizado:', imageUrls.length, 'imagens');

    res.json({ 
      success: true, 
      imageUrls,
      message: `${imageUrls.length} imagens uploadadas com sucesso` 
    });

  } catch (error) {
    console.error('❌ Erro no upload múltiplo:', error);
    
    // ✅ Limpar arquivos temporários em caso de erro
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Erro no upload das imagens' 
    });
  }
});

// ✅ ROTA PARA SERVIR IMAGENS DO GRIDFS
app.get('/api/images/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(imageId)) {
      return res.status(400).json({ error: 'ID de imagem inválido' });
    }
    
    const fileId = new mongoose.Types.ObjectId(imageId);
    
    // ✅ Buscar metadados do arquivo
    const files = await gridFSBucket.find({ _id: fileId }).toArray();
    
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    const file = files[0];
    
    // ✅ Configurar headers
    res.set('Content-Type', file.metadata?.mimetype || 'image/jpeg');
    res.set('Content-Disposition', `inline; filename="${file.filename}"`);
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache de 1 ano
    
    // ✅ Stream da imagem para a resposta
    const downloadStream = gridFSBucket.openDownloadStream(fileId);
    
    downloadStream.on('error', (error) => {
      console.error('❌ Erro ao servir imagem:', error);
      res.status(404).json({ error: 'Imagem não encontrada' });
    });
    
    downloadStream.pipe(res);
    
  } catch (error) {
    console.error('❌ Erro ao servir imagem:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETAR IMAGEM DO GRIDFS
app.delete('/api/upload/:imageId', authenticateToken, requireAdminOrEditor, async (req, res) => {
  try {
    const { imageId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(imageId)) {
      return res.status(400).json({ error: 'ID de imagem inválido' });
    }
    
    const fileId = new mongoose.Types.ObjectId(imageId);
    
    // ✅ Verificar se a imagem existe
    const files = await gridFSBucket.find({ _id: fileId }).toArray();
    
    if (!files || files.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Imagem não encontrada' 
      });
    }
    
    // ✅ Deletar do GridFS
    await gridFSBucket.delete(fileId);
    
    console.log('🗑️ Imagem deletada do GridFS:', imageId);
    
    res.json({ 
      success: true, 
      message: 'Imagem deletada com sucesso' 
    });

  } catch (error) {
    console.error('❌ Erro ao deletar imagem:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao deletar imagem' 
    });
  }
});

// ✅ ROTAS DE USUÁRIOS (APENAS ADMINS)
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, username, password, role = 'viewer' } = req.body;
    
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios' });
    }
    
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Usuário já existe' });
    }
    
    const newUser = new User({
      name,
      username: username.toLowerCase(),
      password,
      role
    });
    
    const savedUser = await newUser.save();
    
    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso',
      user: savedUser.toPublicJSON()
    });
    
  } catch (error) {
    console.error('❌ Erro ao criar usuário:', error);
    res.status(400).json({ error: error.message });
  }
});

// ✅ ROTAS DE POSTS

// LISTAR POSTS (PÚBLICO)
app.get('/api/posts', async (req, res) => {
  try {
    const { category } = req.query;
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      const filter = { isActive: true };
      if (category && category !== 'all') filter.category = category;
      const posts = await Post.find(filter).sort({ date: -1 });
      res.json(posts);
    } else {
      // Fallback
      res.json([{
        _id: 'fallback-1',
        title: 'Sistema IPB Online!',
        text: 'Backend funcionando perfeitamente.',
        category: category || 'Eventos',
        date: new Date().toISOString(),
        images: [],
        author: 'Sistema',
        isActive: true
      }]);
    }
  } catch (error) {
    console.error('❌ Erro em /api/posts:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// CRIAR POST (APENAS ADMINS/EDITORS)
app.post('/api/posts', authenticateToken, requireAdminOrEditor, async (req, res) => {
  try {
    const { title, text, category, date, images = [] } = req.body;
    
    if (!title || !text || !category || !date) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    const newPost = new Post({ 
      title, 
      text, 
      category, 
      date: new Date(date), 
      images,
      author: req.user.name
    });
    
    const savedPost = await newPost.save();
    
    // ✅ Limpeza periódica de imagens órfãs
    setTimeout(() => {
      Post.cleanupOrphanedImages();
    }, 10000);
    
    res.status(201).json(savedPost);
    
  } catch (error) {
    console.error('❌ Erro ao criar post:', error);
    res.status(400).json({ error: error.message });
  }
});

// ATUALIZAR POST (APENAS ADMINS/EDITORS)
app.put('/api/posts/:id', authenticateToken, requireAdminOrEditor, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, category, date, images } = req.body;
    
    if (!title || !text || !category || !date) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    
    const updatedPost = await Post.findByIdAndUpdate(
      id, 
      { title, text, category, date: new Date(date), images },
      { new: true, runValidators: true }
    );
    
    if (!updatedPost) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }
    
    // ✅ Limpeza periódica de imagens órfãs
    setTimeout(() => {
      Post.cleanupOrphanedImages();
    }, 10000);
    
    res.json(updatedPost);
    
  } catch (error) {
    console.error('❌ Erro ao atualizar post:', error);
    res.status(400).json({ error: error.message });
  }
});

// DELETAR POST (APENAS ADMINS/EDITORS)
app.delete('/api/posts/:id', authenticateToken, requireAdminOrEditor, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    
    // ✅ Buscar o post primeiro para possível limpeza de imagens
    const post = await Post.findById(id);
    
    if (!post) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }
    
    const deletedPost = await Post.findByIdAndUpdate(
      id, 
      { isActive: false },
      { new: true }
    );
    
    // ✅ Limpeza periódica de imagens órfãs
    setTimeout(() => {
      Post.cleanupOrphanedImages();
    }, 10000);
    
    res.json({ message: 'Post deletado com sucesso', post: deletedPost });
    
  } catch (error) {
    console.error('❌ Erro ao deletar post:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ ROTA DE HEALTH CHECK
app.get('/api/health', (req, res) => {
  const status = mongoose.connection.readyState;
  const states = { 
    0: 'disconnected', 
    1: 'connected', 
    2: 'connecting', 
    3: 'disconnecting' 
  };
  
  res.json({ 
    message: '🚀 API IPB com Sistema de Upload GridFS!',
    database: states[status],
    readyState: status,
    connected: isDBConnected,
    gridfs: gridFSBucket ? 'ativo' : 'inativo',
    timestamp: new Date().toISOString()
  });
});

// ✅ ROTA PRINCIPAL
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ Backend IPB - Sistema Completo com GridFS Upload!',
    status: 'online',
    database: isDBConnected ? 'conectado' : 'conectando',
    gridfs: gridFSBucket ? 'ativo' : 'inativo',
    timestamp: new Date().toISOString()
  });
});

// ✅ ROTA PARA API INFO
app.get('/api', (req, res) => {
  res.json({ 
    message: '📡 API IPB - Endpoints disponíveis',
    endpoints: {
      auth: {
        login: 'POST /api/auth/login',
        verify: 'GET /api/auth/verify'
      },
      upload: {
        single: 'POST /api/upload',
        multiple: 'POST /api/upload-multiple',
        delete: 'DELETE /api/upload/:imageId',
        serve: 'GET /api/images/:imageId'
      },
      users: {
        list: 'GET /api/users',
        create: 'POST /api/users'
      },
      posts: {
        list: 'GET /api/posts',
        create: 'POST /api/posts',
        update: 'PUT /api/posts/:id',
        delete: 'DELETE /api/posts/:id'
      }
    }
  });
});

// ✅ MIDDLEWARE PARA ROTAS NÃO ENCONTRADAS
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint não encontrado',
    available: ['/', '/api', '/api/health', '/api/auth/login', '/api/posts', '/api/upload', '/api/images/:id']
  });
});

// ✅ MIDDLEWARE DE ERRO PARA MULTER
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Arquivo muito grande. Máximo 5MB.' });
    }
  }
  res.status(500).json({ error: error.message });
});

// ✅ INICIAR CONEXÃO
connectDB();

// ✅ INICIAR SERVIDOR
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Servidor rodando na porta: ${PORT}`);
  console.log(`🔐 JWT Secret: ${JWT_SECRET ? 'Configurado' : 'Usando padrão'}`);
  console.log(`🌐 URL: ${BASE_URL}`);
  console.log(`📁 GridFS: Ativo para armazenamento de imagens`);
  console.log(`📡 Endpoints principais:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/auth/login`);
  console.log(`   POST /api/upload`);
  console.log(`   GET  /api/images/:id`);
  console.log(`   GET  /api/posts`);
});

// ✅ LIMPEZA PERIÓDICA DE IMAGENS ORFÃS (a cada 1 hora)
setInterval(() => {
  if (isDBConnected && gridFSBucket) {
    Post.cleanupOrphanedImages();
  }
}, 60 * 60 * 1000);

module.exports = app;