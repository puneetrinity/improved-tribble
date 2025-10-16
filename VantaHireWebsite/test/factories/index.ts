// Test data factories for VantaHire testing
export interface MockJob {
  id: number;
  title: string;
  type: string;
  location: string;
  description: string;
  skills: string[] | null;
  deadline: Date | null;
  postedBy: number;
  createdAt: Date;
  isActive: boolean;
  status: string;
  reviewComments: string | null;
  expiresAt: Date | null;
  reviewedBy: number | null;
  reviewedAt: Date | null;
}

export interface MockUser {
  id: number;
  username: string;
  email: string;
  password: string;
  role: string;
  createdAt: Date;
}

export interface MockApplication {
  id: number;
  jobId: number;
  name: string;
  email: string;
  phone: string;
  resumeUrl: string;
  coverLetter: string;
  status: string;
  submittedAt: Date;
  reviewedAt: Date | null;
  notes: string | null;
  viewed: boolean;
  downloaded: boolean;
}

export const createMockJob = (overrides?: Partial<MockJob>): MockJob => ({
  id: Math.floor(Math.random() * 1000) + 1,
  title: 'Senior Software Developer',
  type: 'full-time',
  location: 'Remote',
  description: 'We are looking for an experienced software developer to join our team.',
  skills: ['React', 'TypeScript', 'Node.js'],
  deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
  postedBy: 1,
  createdAt: new Date(),
  isActive: true,
  status: 'approved',
  reviewComments: null,
  expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
  reviewedBy: null,
  reviewedAt: null,
  ...overrides
});

export const createMockUser = (overrides?: Partial<MockUser>): MockUser => ({
  id: Math.floor(Math.random() * 1000) + 1,
  username: 'testuser',
  email: 'test@example.com',
  password: 'hashedpassword',
  role: 'candidate',
  createdAt: new Date(),
  ...overrides
});

export const createMockApplication = (overrides?: Partial<MockApplication>): MockApplication => ({
  id: Math.floor(Math.random() * 1000) + 1,
  jobId: 1,
  name: 'John Doe',
  email: 'john@example.com',
  phone: '+1234567890',
  resumeUrl: 'https://example.com/resume.pdf',
  coverLetter: 'I am interested in this position because...',
  status: 'pending',
  submittedAt: new Date(),
  reviewedAt: null,
  notes: null,
  viewed: false,
  downloaded: false,
  ...overrides
});

export const createMockJobs = (count: number = 5): MockJob[] => 
  Array.from({ length: count }, () => createMockJob());

export const createMockUsers = (count: number = 3): MockUser[] => 
  Array.from({ length: count }, () => createMockUser());

export const createMockApplications = (count: number = 10): MockApplication[] => 
  Array.from({ length: count }, () => createMockApplication());