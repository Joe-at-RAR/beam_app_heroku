import { Router } from 'express';
import * as userService from '../services/userService';
import { UserDetails } from '../shared/types';

const router: Router = Router();

// GET / - fetch all users
router.get('/', async (_req, res) => {
  try {
    const users = await userService.getUsers();
    return res.json({ users });
  } catch (error) {
    console.log('Error fetching users:', error);
    return res.status(500).json({ error: 'Error fetching users' });
  }
});

// GET /:silknoteUserUuid - fetch a single user's details
router.get('/:silknoteUserUuid', async (req, res) => {
  const silknoteUserUuid = req.params['silknoteUserUuid'];
  try {
    const user = await userService.getUserById(silknoteUserUuid);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Error fetching user details' });
  }
});

// POST / - create a new user
router.post('/', async (req, res) => {
  try {
    const { id, name, role } = req.body;
    
    // Validate required fields
    if (!id || !name || !role) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          id: !id ? 'Required' : undefined,
          name: !name ? 'Required' : undefined,
          role: !role ? 'Required' : undefined
        }
      });
    }

    const userData: UserDetails = {
      silknoteUserUuid: id,
      name,
      role
    };

    const newUser = await userService.createUser(userData);
    return res.status(200).json({ user: newUser });
  } catch (error) {
    console.log('Error creating user:', error);
    return res.status(500).json({ error: 'Error creating user' });
  }
});

// PUT /:silknoteUserUuid - update a user
router.put('/:silknoteUserUuid', async (req, res) => {
  try {
    const { name, role } = req.body;
    const silknoteUserUuid = req.params['silknoteUserUuid'];
    
    const existingUser = await userService.getUserById(silknoteUserUuid);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = await userService.updateUser({
      ...existingUser,
      name: name || existingUser.name,
      role: role || existingUser.role
    });

    return res.json({ user: updatedUser });
  } catch (error) {
    console.log('Error updating user:', error);
    return res.status(500).json({ error: 'Error updating user' });
  }
});

// DELETE /:silknoteUserUuid - delete a user
router.delete('/:silknoteUserUuid', async (req, res) => {
  try {
    const silknoteUserUuid = req.params['silknoteUserUuid'];
    const deleted = await userService.deleteUser(silknoteUserUuid);
    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.log('Error deleting user:', error);
    return res.status(500).json({ error: 'Error deleting user' });
  }
});

export default router; 