// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
  },
  preferences: {
    theme: { type: String, default: 'light' },
    language: { type: String, default: 'pt-BR' }
  }
}, { 
  timestamps: true 
});

// ✅ MIDDLEWARE PARA HASH DA SENHA ANTES DE SALVAR
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

// ✅ MÉTODO PARA GERAR TOKEN SIMPLES (para login rápido)
userSchema.methods.generateQuickToken = function() {
  return `ipb_${this._id}_${Date.now()}`;
};

// ✅ MÉTODO PARA OBTER DADOS PÚBLICOS (sem senha)
userSchema.methods.toPublicJSON = function() {
  return {
    _id: this._id,
    name: this.name,
    username: this.username,
    role: this.role,
    isActive: this.isActive,
    lastLogin: this.lastLogin,
    preferences: this.preferences,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);