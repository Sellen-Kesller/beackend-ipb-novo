const express = require('express');
const router = express.Router();
const postsController = require('../controllers/postsController');

// Rotas públicas
router.get('/', postsController.getPosts);
router.get('/count', postsController.getPostsCountByCategory);
router.get('/:id', postsController.getPostById);

// Rotas protegidas (futuro - adicionar middleware de auth)
router.post('/', postsController.createPost);
router.put('/:id', postsController.updatePost);
router.delete('/:id', postsController.deletePost);

module.exports = router;