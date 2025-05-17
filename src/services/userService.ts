import { UserDetails } from '@shared/types';
import fs from 'fs/promises';
import path from 'path';

// Path for users.json file
const usersFilePath = path.join(process.cwd(), 'server', 'data', 'users.json');

// In-memory data store for users
let users: { [key: string]: UserDetails } = {};

// Initialize users from file
async function initializeUsersStore() {
  try {
    // Create directory if it doesn't exist
    const dirPath = path.dirname(usersFilePath);
    await fs.mkdir(dirPath, { recursive: true, mode: 0o755 });
    
    try {
      const data = await fs.readFile(usersFilePath, 'utf-8');
      try {
        users = JSON.parse(data);
        console.log('Loaded users from file:', Object.keys(users).length);
      } catch (parseError) {
        console.log('Error parsing users.json:', parseError);
        // Backup corrupted file and create new one
        const backupPath = `${usersFilePath}.backup.${Date.now()}`;
        await fs.rename(usersFilePath, backupPath);
        users = {};
        await persistUsers();
        console.log('Created new users.json file after backup');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, create it with default admin user
        users = {
          'admin-1': {
            silknoteUserUuid: 'admin-1',
            name: 'Admin User',
            role: 'admin'
          }
        };
        await persistUsers();
        console.log('Created new users.json file with default admin user');
      } else {
        console.log('Error loading users:', error);
        throw error;
      }
    }
  } catch (error) {
    console.log('Failed to initialize users store:', error);
    // Initialize with default admin user rather than throwing
    users = {
      'admin-1': {
        silknoteUserUuid: 'admin-1',
        name: 'Admin User',
        role: 'admin'
      }
    };
    await persistUsers();
  }
}

// Save users to file
async function persistUsers() {
  try {
    const data = JSON.stringify(users, null, 2);
    await fs.writeFile(usersFilePath, data, { mode: 0o644 });
    console.log('Successfully persisted users to file');
    return true;
  } catch (error) {
    console.log('Error persisting users:', error);
    return false;
  }
}

// Initialize on module load
(async () => {
  try {
    await initializeUsersStore();
    console.log('User store initialized successfully');
  } catch (error) {
    console.log('Failed to initialize user store:', error);
    // Initialize with default admin user rather than throwing
    users = {
      'admin-1': {
        silknoteUserUuid: 'admin-1',
        name: 'Admin User',
        role: 'admin'
      }
    };
    await persistUsers();
  }
})();

// Export functions for user management
export async function getUsers(): Promise<UserDetails[]> {
  return Object.values(users);
}

export async function getUserById(silknoteUserUuid: string): Promise<UserDetails | null> {
  return users[silknoteUserUuid] || null;
}

export async function createUser(user: UserDetails): Promise<UserDetails> {
  if (!user.silknoteUserUuid) {
    throw new Error('User ID is required');
  }
  
  users[user.silknoteUserUuid] = user;
  const persisted = await persistUsers();
  if (!persisted) {
    throw new Error('Failed to persist user data');
  }
  
  return user;
}

export async function updateUser(user: UserDetails): Promise<UserDetails> {
  if (!user.silknoteUserUuid || !users[user.silknoteUserUuid]) {
    throw new Error('User not found');
  }
  
  users[user.silknoteUserUuid] = user;
  await persistUsers();
  return user;
}

export async function deleteUser(silknoteUserUuid: string): Promise<boolean> {
  if (!users[silknoteUserUuid]) {
    return false;
  }
  
  delete users[silknoteUserUuid];
  await persistUsers();
  return true;
} 