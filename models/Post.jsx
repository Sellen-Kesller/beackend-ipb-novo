const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  text: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Eventos', 'SAF', 'Ensaios', 'Visitas', 'Clube do Livro', 'Aniversariantes']
  },
  images: [{
    type: String // URLs das imagens
  }],
  date: {
    type: Date,
    required: true
  },
  author: {
    type: String,
    default: 'Admin'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true // Cria createdAt e updatedAt automaticamente
});

module.exports = mongoose.model('Post', postSchema);