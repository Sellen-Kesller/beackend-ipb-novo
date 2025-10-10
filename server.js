const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ CONFIGURAÇÃO DUAL: MongoDB + SQLite Fallback
let currentDB = 'sqlite';
const db = new sqlite3.Database('./ipb.db');

// ✅ TENTAR MONGODB PRIMEIRO
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI && MONGODB_URI.includes('mongodb')) {
  mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => {
    console.log('✅ Conectado ao MongoDB Atlas!');
    currentDB = 'mongodb';
    initializeSQLite();
  })
  .catch(err => {
    console.error('❌ Erro MongoDB, usando SQLite:', err.message);
    initializeSQLite();
  });
} else {
  console.log('🔄 String MongoDB não encontrada, usando SQLite...');
  initializeSQLite();
}

// ✅ INICIALIZAR SQLite
function initializeSQLite() {
  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    category TEXT NOT NULL,
    images TEXT,
    date TEXT NOT NULL,
    author TEXT DEFAULT 'Admin',
    isActive INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('❌ Erro SQLite:', err);
    } else {
      console.log('✅ SQLite pronto (fallback)');
    }
  });
}

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
  res.json({ 
    message: '🚀 Backend IPB funcionando!', 
    database: currentDB,
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1
  });
});

// ✅ ROTAS DOS POSTS - ORDEM CORRETA!

// 1️⃣ ROTA ESPECÍFICA: /api/posts/count (DEVE VIR ANTES!)
app.get('/api/posts/count', async (req, res) => {
  try {
    console.log('📊 Buscando contagens por categoria...');
    
    // Resultado padrão com todas categorias
    const result = {
      'Eventos': 0,
      'SAF': 0, 
      'Ensaios': 0,
      'Visitas': 0,
      'Clube do Livro': 0,
      'Aniversariantes': 0
    };
    
    if (currentDB === 'mongodb') {
      const counts = await Post.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]);
      
      console.log('📈 Contagens MongoDB:', counts);
      
      counts.forEach(item => {
        if (result.hasOwnProperty(item._id)) {
          result[item._id] = item.count;
        }
      });
      
      console.log('🎯 Contagens finais:', result);
      res.json(result);
      
    } else {
      // SQLite
      const query = `SELECT category, COUNT(*) as count FROM posts WHERE isActive = 1 GROUP BY category`;
      db.all(query, [], (err, rows) => {
        if (err) {
          console.error('❌ Erro SQLite count:', err);
          return res.json(result);
        }
        
        console.log('📈 Contagens SQLite:', rows);
        
        rows.forEach(row => {
          if (result.hasOwnProperty(row.category)) {
            result[row.category] = row.count;
          }
        });
        
        console.log('🎯 Contagens finais:', result);
        res.json(result);
      });
    }
    
  } catch (error) {
    console.error('❌ Erro em /api/posts/count:', error);
    // Retorna resultado padrão mesmo com erro
    res.json({
      'Eventos': 0,
      'SAF': 0, 
      'Ensaios': 0,
      'Visitas': 0,
      'Clube do Livro': 0,
      'Aniversariantes': 0
    });
  }
});

// 2️⃣ ROTA GERAL: GET /api/posts
app.get('/api/posts', async (req, res) => {
  try {
    const { category } = req.query;
    
    if (currentDB === 'mongodb') {
      const filter = { isActive: true };
      if (category) filter.category = category;
      const posts = await Post.find(filter).sort({ date: -1 });
      res.json(posts);
    } else {
      let query = 'SELECT * FROM posts WHERE isActive = 1';
      const params = [];
      if (category) {
        query += ' AND category = ?';
        params.push(category);
      }
      query += ' ORDER BY date DESC';
      
      db.all(query, params, (err, rows) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        const posts = rows.map(row => ({
          _id: row.id.toString(),
          id: row.id.toString(),
          title: row.title,
          text: row.text,
          category: row.category,
          images: row.images ? JSON.parse(row.images) : [],
          date: row.date,
          author: row.author,
          isActive: row.isActive === 1,
          createdAt: row.createdAt
        }));
        res.json(posts);
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3️⃣ ROTA GERAL: POST /api/posts
app.post('/api/posts', async (req, res) => {
  try {
    const { title, text, category, date, images = [] } = req.body;
    
    if (!title || !text || !category || !date) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    if (currentDB === 'mongodb') {
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
      const query = `INSERT INTO posts (title, text, category, images, date) VALUES (?, ?, ?, ?, ?)`;
      db.run(query, [title, text, category, JSON.stringify(images), date], function(err) {
        if (err) {
          res.status(400).json({ error: err.message });
          return;
        }
        db.get('SELECT * FROM posts WHERE id = ?', [this.lastID], (err, row) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          const newPost = {
            _id: row.id.toString(),
            id: row.id.toString(),
            title: row.title,
            text: row.text,
            category: row.category,
            images: row.images ? JSON.parse(row.images) : [],
            date: row.date,
            author: row.author,
            isActive: row.isActive === 1,
            createdAt: row.createdAt
          };
          res.status(201).json(newPost);
        });
      });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 4️⃣ ROTAS COM PARÂMETROS (VÊM POR ÚLTIMO!)

// GET /api/posts/:id
app.get('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (currentDB === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const post = await Post.findOne({ _id: id, isActive: true });
      if (!post) {
        return res.status(404).json({ error: 'Post não encontrado' });
      }
      res.json(post);
    } else {
      db.get('SELECT * FROM posts WHERE id = ? AND isActive = 1', [id], (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        if (!row) {
          res.status(404).json({ error: 'Post não encontrado' });
          return;
        }
        const post = {
          _id: row.id.toString(),
          id: row.id.toString(),
          title: row.title,
          text: row.text,
          category: row.category,
          images: row.images ? JSON.parse(row.images) : [],
          date: row.date,
          author: row.author,
          isActive: row.isActive === 1,
          createdAt: row.createdAt
        };
        res.json(post);
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/posts/:id
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, category, date, images } = req.body;
    
    if (!title || !text || !category || !date) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    if (currentDB === 'mongodb') {
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
      const query = `UPDATE posts SET title = ?, text = ?, category = ?, date = ?, images = ? WHERE id = ? AND isActive = 1`;
      db.run(query, [title, text, category, date, JSON.stringify(images), id], function(err) {
        if (err) {
          res.status(400).json({ error: err.message });
          return;
        }
        if (this.changes === 0) {
          res.status(404).json({ error: 'Post não encontrado' });
          return;
        }
        db.get('SELECT * FROM posts WHERE id = ?', [id], (err, row) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          const updatedPost = {
            _id: row.id.toString(),
            id: row.id.toString(),
            title: row.title,
            text: row.text,
            category: row.category,
            images: row.images ? JSON.parse(row.images) : [],
            date: row.date,
            author: row.author,
            isActive: row.isActive === 1,
            createdAt: row.createdAt
          };
          res.json(updatedPost);
        });
      });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/posts/:id
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (currentDB === 'mongodb') {
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
    } else {
      const query = `UPDATE posts SET isActive = 0 WHERE id = ?`;
      db.run(query, [id], function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        if (this.changes === 0) {
          res.status(404).json({ error: 'Post não encontrado' });
          return;
        }
        res.json({ message: 'Post deletado com sucesso', id });
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ MIDDLEWARE DE 404 PARA ROTAS NÃO ENCONTRADAS
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado' });
});

// ✅ INICIAR SERVIDOR
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🎯 Servidor rodando: http://localhost:${PORT}`);
  console.log(`💾 Banco atual: ${currentDB}`);
  console.log('📡 Endpoints disponíveis:');
  console.log('   GET  /api/health');
  console.log('   GET  /api/posts/count');
  console.log('   GET  /api/posts');
  console.log('   GET  /api/posts/:id');
  console.log('   POST /api/posts');
  console.log('   PUT  /api/posts/:id');
  console.log('   DELETE /api/posts/:id');
});

// ✅ TRATAMENTO DE ERROS GLOBAIS
process.on('unhandledRejection', (err) => {
  console.error('❌ Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Exceção não capturada:', err);
});