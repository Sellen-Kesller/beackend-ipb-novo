const Post = require('../models/Post');

// GET - Todos os posts (com filtro por categoria)
exports.getPosts = async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { isActive: true };
    
    if (category) {
      filter.category = category;
    }

    const posts = await Post.find(filter).sort({ date: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar posts' });
  }
};

// GET - Post por ID
exports.getPostById = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar post' });
  }
};

// POST - Criar novo post
exports.createPost = async (req, res) => {
  try {
    const { title, text, category, date, images = [] } = req.body;
    
    const newPost = new Post({
      title,
      text,
      category,
      date: new Date(date),
      images
    });

    const savedPost = await newPost.save();
    
    // ✅ EMITIR NOTIFICAÇÃO PUSH AQUI (futuro)
    // await sendPushNotification(category, title);
    
    res.status(201).json(savedPost);
  } catch (error) {
    res.status(400).json({ error: 'Erro ao criar post' });
  }
};

// PUT - Atualizar post
exports.updatePost = async (req, res) => {
  try {
    const updatedPost = await Post.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!updatedPost) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }
    
    res.json(updatedPost);
  } catch (error) {
    res.status(400).json({ error: 'Erro ao atualizar post' });
  }
};

// DELETE - Deletar post (soft delete)
exports.deletePost = async (req, res) => {
  try {
    const deletedPost = await Post.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!deletedPost) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }
    
    res.json({ message: 'Post deletado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar post' });
  }
};

// GET - Contagem de posts por categoria
exports.getPostsCountByCategory = async (req, res) => {
  try {
    const counts = await Post.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    
    const result = {};
    counts.forEach(item => {
      result[item._id] = item.count;
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao contar posts' });
  }
};