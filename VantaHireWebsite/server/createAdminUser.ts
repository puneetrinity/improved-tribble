import { storage } from './storage';
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

function generateSecurePassword(length: number = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i]! % chars.length];
  }
  return password;
}

export async function createAdminUser() {
  try {
    // Check if admin user already exists (check both old and new format)
    const existingAdmin = await storage.getUserByUsername('admin@vantahire.local')
                       || await storage.getUserByUsername('admin');
    if (existingAdmin) {
      console.log('✓ Admin user already exists');
      return existingAdmin;
    }

    // First-time bootstrap only: create admin with a random password.
    // The operator is expected to reset it via psql before first login.
    const hashedPassword = await hashPassword(generateSecurePassword(24));
    const adminUser = await storage.createUser({
      username: 'admin@vantahire.local',
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'super_admin'
    });

    console.log('✅ Super Admin user created with a random password. Reset it via psql before first login.');

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

    console.log('Test recruiter created successfully');
    console.log('Username: recruiter');
    console.log('Role: recruiter');
    // Password intentionally not logged for security
    
    return recruiterUser;
  } catch (error) {
    console.error('Error creating test recruiter:', error);
    throw error;
  }
}

