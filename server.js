const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

// ✅ CONFIGURAÇÃO DO MULTER PARA UPLOAD
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/posts/';
    
    // ✅ Criar diretório se não existir
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // ✅ Nome único para o arquivo
    const uniqueName = `post_${Date.now()}_${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
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

// ✅ SERVIR ARQUIVOS ESTÁTICOS (IMPORTANTE!)
app.use('/uploads', express.static('uploads'));

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
  images: [{ type: String }],
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

// ✅ MÉTODO PARA LIMPEZA DE IMAGENS ORFÃS
postSchema.statics.cleanupOrphanedImages = async function() {
  try {
    const usedImages = await this.distinct('images');
    const uploadDir = 'uploads/posts/';
    
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      
      for (const file of files) {
        const fileUrl = `${BASE_URL}/uploads/posts/${file}`;
        
        if (!usedImages.includes(fileUrl)) {
          fs.unlinkSync(path.join(uploadDir, file));
          console.log('🧹 Imagem órfã removida:', file);
        }
      }
    }
  } catch (error) {
    console.error('❌ Erro na limpeza de imagens:', error);
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

// ✅ ROTAS DE UPLOAD DE IMAGENS

// UPLOAD DE IMAGEM ÚNICA
app.post('/api/upload', authenticateToken, requireAdminOrEditor, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhuma imagem enviada' 
      });
    }

    // ✅ URL permanente da imagem
    const imageUrl = `${BASE_URL}/uploads/posts/${req.file.filename}`;

    console.log('✅ Upload realizado:', imageUrl);

    res.json({ 
      success: true, 
      imageUrl,
      filename: req.file.filename,
      message: 'Upload realizado com sucesso' 
    });

  } catch (error) {
    console.error('❌ Erro no upload:', error);
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
    
    // ✅ URLs de todas as imagens
    const imageUrls = req.files.map(file => 
      `${BASE_URL}/uploads/posts/${file.filename}`
    );

    console.log('✅ Upload múltiplo realizado:', imageUrls.length, 'imagens');

    res.json({ 
      success: true, 
      imageUrls,
      message: `${imageUrls.length} imagens uploadadas com sucesso` 
    });

  } catch (error) {
    console.error('❌ Erro no upload múltiplo:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro no upload das imagens' 
    });
  }
});

// DELETAR IMAGEM
app.delete('/api/upload/:filename', authenticateToken, requireAdminOrEditor, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join('uploads/posts/', filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ Imagem deletada:', filename);
      
      res.json({ 
        success: true, 
        message: 'Imagem deletada com sucesso' 
      });
    } else {
      res.status(404).json({ 
        success: false, 
        error: 'Arquivo não encontrado' 
      });
    }

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
    message: '🚀 API IPB com Sistema de Upload!',
    database: states[status],
    readyState: status,
    connected: isDBConnected,
    uploads: fs.existsSync('uploads/posts/') ? 'ativo' : 'inativo',
    timestamp: new Date().toISOString()
  });
});

// ✅ ROTA PRINCIPAL
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ Backend IPB - Sistema Completo com Upload!',
    status: 'online',
    database: isDBConnected ? 'conectado' : 'conectando',
    uploads: 'ativo',
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
        delete: 'DELETE /api/upload/:filename'
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
    available: ['/', '/api', '/api/health', '/api/auth/login', '/api/posts', '/api/upload']
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
  console.log(`📁 Uploads: ${BASE_URL}/uploads/posts/`);
  console.log(`📡 Endpoints principais:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/auth/login`);
  console.log(`   POST /api/upload`);
  console.log(`   GET  /api/posts`);
});

// ✅ LIMPEZA PERIÓDICA DE IMAGENS ORFÃS (a cada 1 hora)
setInterval(() => {
  if (isDBConnected) {
    Post.cleanupOrphanedImages();
  }
}, 60 * 60 * 1000);

module.exports = app;