const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

require('dotenv').config();

const app = express();

// ✅ Middlewares
app.use(cors());
app.use(express.json());

// ✅ CONEXÃO MONGODB OTIMIZADA PARA RENDER
const MONGODB_URI = process.env.MONGODB_URI;

let isDBConnected = false;

const connectDB = async () => {
  try {
    console.log('🔗 Conectando ao MongoDB Atlas...');
    
    if (!MONGODB_URI) {
      console.log('❌ MONGODB_URI não encontrada');
      return;
    }
    
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      retryWrites: true,
    });
    
    isDBConnected = true;
    console.log('✅ MongoDB CONECTADO!');
    
  } catch (error) {
    console.error('❌ Erro MongoDB:', error.message);
    isDBConnected = false;
    
    // ✅ RECONEXÃO EM 10 SEGUNDOS
    setTimeout(connectDB, 10000);
  }
};

// Event listeners
mongoose.connection.on('connected', () => {
  console.log('✅ Mongoose conectado');
  isDBConnected = true;
});

mongoose.connection.on('error', (err) => {
  console.log('❌ Erro Mongoose:', err.message);
  isDBConnected = false;
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️  Mongoose desconectado - Reconectando...');
  isDBConnected = false;
  setTimeout(connectDB, 10000);
});

// ✅ MODELO MONGODB
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

const Post = mongoose.model('Post', postSchema);

// ✅ HEALTH CHECK MELHORADO
app.get('/api/health', (req, res) => {
  const status = mongoose.connection.readyState;
  const states = { 
    0: 'disconnected', 
    1: 'connected', 
    2: 'connecting', 
    3: 'disconnecting' 
  };
  
  res.json({ 
    message: '🚀 API IPB no Render!',
    database: states[status],
    readyState: status,
    connected: isDBConnected,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ✅ ROTA DE LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const cleanUsername = username?.trim() || '';
    const cleanPassword = password?.trim() || '';
    
    console.log('🔐 Tentativa de login:', cleanUsername);
    
    // ✅ CREDENCIAIS FIXAS (PARA TESTE - EM PRODUÇÃO USE BANCO DE DADOS)
    const validCredentials = {
      username: 'admin',
      password: '12'
    };
    
    if (cleanUsername === validCredentials.username && 
        cleanPassword === validCredentials.password) {
      
      return res.json({ 
        success: true, 
        message: 'Login realizado com sucesso!',
        user: { 
          username: cleanUsername, 
          role: 'admin',
          name: 'Administrador IPB'
        }
      });
      
    } else {
      console.warn('❌ Tentativa de login falhou:', cleanUsername);
      return res.status(401).json({ 
        success: false, 
        error: 'Credenciais inválidas' 
      });
    }
    
  } catch (error) {
    console.error('💥 Erro no login:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// ✅ ROTA PRINCIPAL
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ Backend IPB funcionando no Render!',
    status: 'online',
    database: isDBConnected ? 'conectado' : 'conectando',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ✅ ROTA DE TESTE DE API
app.get('/api', (req, res) => {
  res.json({ 
    message: '📡 API IPB - Endpoints disponíveis',
    endpoints: {
      health: '/api/health',
      login: '/api/auth/login',
      posts: '/api/posts',
      postsCount: '/api/posts/count'
    },
    timestamp: new Date().toISOString()
  });
});

// ✅ ROTAS DOS POSTS COM MELHOR TRATAMENTO DE ERRO
app.get('/api/posts', async (req, res) => {
  try {
    const { category } = req.query;
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      const filter = { isActive: true };
      if (category && category !== 'all') {
        filter.category = category;
      }
      const posts = await Post.find(filter).sort({ date: -1 });
      res.json(posts);
    } else {
      // ✅ FALLBACK ELEGANTE QUANDO MONGODB ESTÁ INDISPONÍVEL
      res.json([
        {
          _id: 'fallback-1',
          title: 'Sistema IPB Online!',
          text: 'Backend funcionando perfeitamente no Render. Banco de dados em conexão...',
          category: category || 'Eventos',
          date: new Date().toISOString(),
          images: [],
          author: 'Sistema',
          isActive: true,
          createdAt: new Date().toISOString()
        }
      ]);
    }
  } catch (error) {
    console.error('❌ Erro em /api/posts:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// ✅ ROTA DE CONTAGEM
app.get('/api/posts/count', async (req, res) => {
  try {
    const defaultCounts = {
      'Eventos': 0, 'SAF': 0, 'Ensaios': 0, 
      'Visitas': 0, 'Clube do Livro': 0, 'Aniversariantes': 0
    };
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      const counts = await Post.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]);
      
      counts.forEach(item => {
        if (defaultCounts.hasOwnProperty(item._id)) {
          defaultCounts[item._id] = item.count;
        }
      });
    }
    
    res.json(defaultCounts);
    
  } catch (error) {
    console.error('❌ Erro em /api/posts/count:', error);
    res.json({
      'Eventos': 0, 'SAF': 0, 'Ensaios': 0, 
      'Visitas': 0, 'Clube do Livro': 0, 'Aniversariantes': 0
    });
  }
});

// ✅ ROTA PARA CRIAR POST
app.post('/api/posts', async (req, res) => {
  try {
    const { title, text, category, date, images = [] } = req.body;
    
    // ✅ VALIDAÇÃO MELHORADA
    if (!title || !text || !category || !date) {
      return res.status(400).json({ 
        error: 'Todos os campos são obrigatórios',
        required: ['title', 'text', 'category', 'date']
      });
    }
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      const newPost = new Post({ 
        title, 
        text, 
        category, 
        date: new Date(date), 
        images 
      });
      const savedPost = await newPost.save();
      res.status(201).json(savedPost);
    } else {
      res.status(503).json({ 
        error: 'Banco de dados temporariamente indisponível',
        tryAgain: true
      });
    }
  } catch (error) {
    console.error('❌ Erro ao criar post:', error);
    res.status(400).json({ 
      error: 'Erro ao criar post',
      message: error.message 
    });
  }
});

// ✅ ROTA PARA OBTER POST POR ID
app.get('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const post = await Post.findOne({ _id: id, isActive: true });
      if (!post) {
        return res.status(404).json({ error: 'Post não encontrado' });
      }
      res.json(post);
    } else {
      res.status(503).json({ 
        error: 'Banco de dados temporariamente indisponível',
        tryAgain: true
      });
    }
  } catch (error) {
    console.error('❌ Erro ao buscar post:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ ROTA PARA ATUALIZAR POST
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, category, date, images } = req.body;
    
    if (!title || !text || !category || !date) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
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
    } else {
      res.status(503).json({ 
        error: 'Banco de dados temporariamente indisponível',
        tryAgain: true
      });
    }
  } catch (error) {
    console.error('❌ Erro ao atualizar post:', error);
    res.status(400).json({ error: error.message });
  }
});

// ✅ ROTA PARA EXCLUIR POST (SOFT DELETE)
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
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
      res.json({ 
        message: 'Post deletado com sucesso', 
        post: deletedPost 
      });
    } else {
      res.status(503).json({ 
        error: 'Banco de dados temporariamente indisponível',
        tryAgain: true
      });
    }
  } catch (error) {
    console.error('❌ Erro ao excluir post:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ MIDDLEWARE PARA ROTAS NÃO ENCONTRADAS
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint não encontrado',
    path: req.originalUrl,
    availableEndpoints: [
      'GET  /',
      'GET  /api',
      'GET  /api/health',
      'POST /api/auth/login',
      'GET  /api/posts',
      'GET  /api/posts/count',
      'POST /api/posts',
      'GET  /api/posts/:id',
      'PUT  /api/posts/:id',
      'DELETE /api/posts/:id'
    ]
  });
});

// ✅ INICIAR CONEXÃO
connectDB();

// ✅ INICIAR SERVIDOR
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Servidor rodando na porta: ${PORT}`);
  console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💾 MongoDB State: ${mongoose.connection.readyState}`);
  console.log(`📡 URL: http://localhost:${PORT}`);
});

module.exports = app;