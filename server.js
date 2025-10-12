const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

require('dotenv').config();

const app = express();

// ✅ Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ CONEXÃO MONGODB OTIMIZADA
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ipb-app';

let isDBConnected = false;

const connectDB = async () => {
  try {
    console.log('🔗 Conectando ao MongoDB...');
    
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

// ✅ HEALTH CHECK
app.get('/api/health', (req, res) => {
  const status = mongoose.connection.readyState;
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  
  res.json({ 
    message: '🚀 API IPB no Render!',
    database: states[status],
    readyState: status,
    connected: isDBConnected,
    timestamp: new Date().toISOString()
  });
});

// ✅ ROTA DE LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const cleanUsername = username?.trim() || '';
    const cleanPassword = password?.trim() || '';
    
    console.log('🔐 Login attempt:', cleanUsername);
    
    const validCredentials = {
      username: 'admin',
      password: '12'
    };
    
    if (cleanUsername === validCredentials.username && 
        cleanPassword === validCredentials.password) {
      
      return res.json({ 
        success: true, 
        message: 'Login realizado com sucesso!',
        user: { username: cleanUsername, role: 'admin' }
      });
      
    } else {
      return res.status(401).json({ 
        success: false, 
        error: 'Credenciais inválidas' 
      });
    }
    
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ✅ ROTA PRINCIPAL
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ Backend IPB no Render!',
    status: 'online',
    database: isDBConnected ? 'conectado' : 'conectando',
    timestamp: new Date().toISOString()
  });
});

// ✅ ROTAS DOS POSTS
app.get('/api/posts', async (req, res) => {
  try {
    const { category } = req.query;
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      const filter = { isActive: true };
      if (category) filter.category = category;
      const posts = await Post.find(filter).sort({ date: -1 });
      res.json(posts);
    } else {
      // ✅ FALLBACK ELEGANTE
      res.json([
        {
          _id: '1',
          title: 'Sistema IPB no Render!',
          text: 'Sistema migrado para Render - Mais estável e confiável!',
          category: category || 'Eventos',
          date: new Date().toISOString(),
          images: [],
          author: 'Admin'
        }
      ]);
    }
  } catch (error) {
    console.error('❌ Erro em /api/posts:', error);
    res.json([
      {
        _id: 'error',
        title: 'Sistema em Operação',
        text: 'Backend funcionando no Render!',
        category: 'Eventos',
        date: new Date().toISOString(),
        images: []
      }
    ]);
  }
});

// ✅ ROTA DE CONTAGEM
app.get('/api/posts/count', async (req, res) => {
  try {
    const result = {
      'Eventos': 0, 'SAF': 0, 'Ensaios': 0, 
      'Visitas': 0, 'Clube do Livro': 0, 'Aniversariantes': 0
    };
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      const counts = await Post.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]);
      
      counts.forEach(item => {
        if (result.hasOwnProperty(item._id)) {
          result[item._id] = item.count;
        }
      });
    }
    
    res.json(result);
    
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
    
    if (!title || !text || !category || !date) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      const newPost = new Post({ 
        title, text, category, date: new Date(date), images 
      });
      const savedPost = await newPost.save();
      res.status(201).json(savedPost);
    } else {
      res.status(503).json({ 
        error: 'Banco de dados temporariamente indisponível'
      });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ✅ OUTRAS ROTAS (GET by ID, PUT, DELETE)
app.get('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (isDBConnected && mongoose.connection.readyState === 1) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const post = await Post.findOne({ _id: id, isActive: true });
      if (!post) return res.status(404).json({ error: 'Post não encontrado' });
      res.json(post);
    } else {
      res.status(503).json({ error: 'Banco indisponível' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
      if (!updatedPost) return res.status(404).json({ error: 'Post não encontrado' });
      res.json(updatedPost);
    } else {
      res.status(503).json({ error: 'Banco indisponível' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

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
      if (!deletedPost) return res.status(404).json({ error: 'Post não encontrado' });
      res.json({ message: 'Post deletado com sucesso', post: deletedPost });
    } else {
      res.status(503).json({ error: 'Banco indisponível' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ INICIAR CONEXÃO E SERVIDOR
connectDB();

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Servidor rodando na porta: ${PORT}`);
  console.log(`💾 MongoDB State: ${mongoose.connection.readyState}`);
});

module.exports = app;