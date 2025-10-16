import { storage } from './storage';
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function createAdminUser() {
  try {
    // Check if admin user already exists
    const existingAdmin = await storage.getUserByUsername('admin');
    if (existingAdmin) {
      console.log('Admin user already exists');
      return existingAdmin;
    }

    // Create admin user
    const hashedPassword = await hashPassword('admin123');
    const adminUser = await storage.createUser({
      username: 'admin',
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'admin'
    });

    console.log('Admin user created successfully:');
    console.log('Username: admin');
    console.log('Password: admin123');
    console.log('Role: admin');
    
    return adminUser;
  } catch (error) {
    console.error('Error creating admin user:', error);
    throw error;
  }
}

export async function createTestRecruiter() {
  try {
    // Check if recruiter user already exists
    const existingRecruiter = await storage.getUserByUsername('recruiter');
    if (existingRecruiter) {
      console.log('Test recruiter already exists');
      return existingRecruiter;
    }

    // Create recruiter user
    const hashedPassword = await hashPassword('recruiter123');
    const recruiterUser = await storage.createUser({
      username: 'recruiter',
      password: hashedPassword,
      firstName: 'Test',
      lastName: 'Recruiter',
      role: 'recruiter'
    });

    console.log('Test recruiter created successfully:');
    console.log('Username: recruiter');
    console.log('Password: recruiter123');
    console.log('Role: recruiter');
    
    return recruiterUser;
  } catch (error) {
    console.error('Error creating test recruiter:', error);
    throw error;
  }
}