const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const User = require('./models/User'); // ✅ IMPORTE O MODELO DE USUÁRIO

require('dotenv').config();

const app = express();

// ✅ Middlewares
app.use(cors());
app.use(express.json());

// ✅ CONFIGURAÇÕES
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'ipb_jwt_secret_2024';
const QUICK_TOKEN_SECRET = process.env.QUICK_TOKEN_SECRET || 'ipb_quick_token_2024';

let isDBConnected = false;

const connectDB = async () => {
  try {
    console.log('🔗 Conectando ao MongoDB...');
    
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
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Autenticação requerida' });
  }
  next();
};

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
      // ✅ USUÁRIO VIEWER PARA TESTE
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
        userId: user._id, 
        username: user.username, 
        name: user.name, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '30d' } // Token expira em 30 dias
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
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao verificar token' 
    });
  }
});

// ✅ ROTAS DE USUÁRIOS (APENAS ADMINS)

// LISTAR TODOS OS USUÁRIOS
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CRIAR NOVO USUÁRIO
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
      password, // A senha será hasheada automaticamente pelo middleware
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

// ATUALIZAR USUÁRIO
app.put('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, isActive, preferences } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { name, role, isActive, preferences },
      { new: true, select: '-password' }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    res.json({
      success: true,
      message: 'Usuário atualizado com sucesso',
      user: updatedUser
    });
    
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ✅ ROTAS DE POSTS COM CONTROLE DE ACESSO

// GET POSTS (PÚBLICO - TODOS PODEM VER)
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
        author: 'Sistema'
      }]);
    }
  } catch (error) {
    console.error('❌ Erro em /api/posts:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ✅ CRIAÇÃO/EDIÇÃO/EXCLUSÃO APENAS PARA ADMINS E EDITORS
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
      author: req.user.name // ✅ USA O NOME DO USUÁRIO LOGADO
    });
    
    const savedPost = await newPost.save();
    res.status(201).json(savedPost);
    
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

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
    
    res.json(updatedPost);
    
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/posts/:id', authenticateToken, requireAdminOrEditor, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    
    const deletedPost = await Post.findByIdAndUpdate(
      id, 
      { isActive: false },
      { new: true }
    );
    
    if (!deletedPost) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }
    
    res.json({ message: 'Post deletado com sucesso', post: deletedPost });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ ROTAS PÚBLICAS
app.get('/api/health', (req, res) => {
  const status = mongoose.connection.readyState;
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  
  res.json({ 
    message: '🚀 API IPB com Sistema de Usuários!',
    database: states[status],
    readyState: status,
    connected: isDBConnected,
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: '✅ Backend IPB - Sistema Completo!',
    features: [
      'Sistema de usuários com roles (admin, editor, viewer)',
      'Autenticação JWT',
      'Login automático com token',
      'Controle de acesso granular'
    ],
    timestamp: new Date().toISOString()
  });
});

// ✅ INICIAR CONEXÃO
connectDB();

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Servidor rodando na porta: ${PORT}`);
  console.log(`🔐 Sistema de autenticação JWT ativo`);
  console.log(`👥 Usuários: Almir(1515), Franklin(1212), Marcio(1010), Milena(1111), Sabrina(2020)`);
});

module.exports = app;