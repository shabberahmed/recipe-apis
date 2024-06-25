const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Recipe = require('./models/Recipe');

dotenv.config();

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
.then(()=>console.log("connected to the database"))
.catch((err)=>console.log(`mongoose error ${err}`))

// Middleware to protect routes
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      next();
    } catch (error) {
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }
  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

// Register route
app.post('/users/register', async (req, res) => {
  const { username,email, password } = req.body;
  try {
    const user = await User.create({ username,email, password });
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(400).json({ message: 'User registration failed', error });
  }
});

// Login route
app.post('/users/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
      res.json({ token ,user:user});
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(400).json({ message: 'Login failed', error });
  }
});

// Get public recipes
app.get('/recipes/public', async (req, res) => {
  try {
    const recipes = await Recipe.find({ isPublic: true });
    res.json(recipes);
  } catch (error) {
    res.status(400).json({ message: 'Failed to fetch public recipes', error });
  }
});

// Get private recipes
app.get('/recipes/private', async (req, res) => {
  try {
    const recipes = await Recipe.find({ user: req.body.user, isPublic: false });
    console.log(recipes)
    res.json(recipes);
  } catch (error) {
    console.log(error)
    res.status(400).json({ message: 'Failed to fetch private recipes',  error: error.message  });
  }
});

// Add a new recipe
app.post('/recipes', protect, async (req, res) => {
  const { title, ingredients, instructions, isPublic,recipeType } = req.body;

  if (!Array.isArray(ingredients) || !Array.isArray(instructions)) {
    return res.status(400).json({ message: 'Ingredients and instructions must be arrays of strings' });
  }

  try {
    const recipe = await Recipe.create({
      title,
      ingredients,
      instructions,
      isPublic,
      recipeType,
      user: req.user._id
    });
    res.status(201).json(recipe);
  } catch (error) {
    res.status(400).json({ message: 'Failed to add recipe', error });
  }
});

// POST /recipes/:recipeId/ratings
app.post('/recipes/:recipeId/ratings', async (req, res) => {
  const { recipeId } = req.params;
  const { userId, rating } = req.body;

  try {
    const recipe = await Recipe.findById(recipeId);
    if (!recipe) {
      return res.status(404).send({ message: 'Recipe not found' });
    }

    // Check if the user has already rated the recipe
    const existingRating = recipe.ratings.find(r => r.user.toString() === userId);
    if (existingRating) {
      return res.status(400).send({ message: 'User has already rated this recipe' });
    }

    // Add new rating
    recipe.ratings.push({ user:new mongoose.Types.ObjectId(userId), rating });
    await recipe.save();

    res.status(201).send({ message: 'Rating added successfully' });
  } catch (error) {
    res.status(500).send({ message: 'Server error', error:error.message });
  }
});

// PUT /recipes/:recipeId/ratings
app.put('/recipes/:recipeId/ratings', async (req, res) => {
  const { recipeId } = req.params;
  const { userId, rating } = req.body;

  try {
    const recipe = await Recipe.findById(recipeId);
    if (!recipe) {
      return res.status(404).send({ message: 'Recipe not found' });
    }

    // Find the rating by the user
    const userRating = recipe.ratings.find(r => r.user.toString() === userId);
    if (!userRating) {
      return res.status(404).send({ message: 'Rating by user not found' });
    }

    // Update the rating
    userRating.rating = rating;
    await recipe.save();

    res.send({ message: 'Rating updated successfully' });
  } catch (error) {
    res.status(500).send({ message: 'Server error', error });
  }
});

// GET /recipes/:recipeId/ratings/average
app.get('/recipes/:recipeId/ratings/average', async (req, res) => {
  const { recipeId } = req.params;

  try {
    const recipe = await Recipe.findById(recipeId);
    if (!recipe) {
      return res.status(404).send({ message: 'Recipe not found' });
    }

    // Calculate average rating
    const averageRating = recipe.ratings.reduce((acc, r) => acc + r.rating, 0) / recipe.ratings.length;

    res.send({ averageRating });
  } catch (error) {
    res.status(500).send({ message: 'Server error', error });
  }
});
// Edit a recipe
app.put('/api/recipes/:recipeId', async (req, res) => {
  const { recipeId } = req.params;
  const { title, ingredients, instructions, isPublic, recipeType,user } = req.body;

  if (!Array.isArray(ingredients) || !Array.isArray(instructions)) {
    return res.status(400).json({ message: 'Ingredients and instructions must be arrays of strings' });
  }

  try {
    const recipe = await Recipe.findById(recipeId);

    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }

    // Check if the user owns the recipe
    if (recipe.user.toString() !== user.toString()) {
      return res.status(403).json({ message: 'User not authorized to edit this recipe' });
    }

    // Update the recipe details
    recipe.title = title || recipe.title;
    recipe.ingredients = ingredients || recipe.ingredients;
    recipe.instructions = instructions || recipe.instructions;
    recipe.isPublic = isPublic !== undefined ? isPublic : recipe.isPublic;
    recipe.recipeType = recipeType || recipe.recipeType;

    await recipe.save();

    res.json({ message: 'Recipe updated successfully', recipe });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});
// Delete a recipe
app.delete('/api/recipes/:recipeId', async (req, res) => {
  const { recipeId } = req.params;
  const { user } = req.body;


  try {
    const recipe = await Recipe.findById(recipeId);

    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }

    // Check if the user owns the recipe
    if (recipe.user.toString() !== user.toString()) {
      return res.status(403).json({ message: 'User not authorized to delete this recipe' });
    }
    await Recipe.findByIdAndDelete(recipeId)

    return res.json({ message: 'Recipe deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error:error.message});
  }
});

// Filter recipes by recipe type
app.get('/recipes/filter', async (req, res) => {
  const { recipeType } = req.query;

  try {
    const recipes = await Recipe.find({
      recipeType,
      isPublic: true
    });

    res.json(recipes);
  } catch (error) {
    res.status(400).json({ message: 'Failed to fetch recipes', error });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
