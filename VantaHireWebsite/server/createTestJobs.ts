import { storage } from './storage';

export async function createTestJobs() {
  try {
    // Get the test recruiter user
    const recruiter = await storage.getUserByUsername('recruiter');
    if (!recruiter) {
      console.log('Test recruiter not found, skipping job creation');
      return;
    }

    // Check if test jobs already exist
    const existingJobs = await storage.getJobsByUser(recruiter.id);
    if (existingJobs.length > 0) {
      console.log('Test jobs already exist');
      return;
    }

    // Create test job 1 - Pending
    const job1 = await storage.createJob({
      title: "Senior Full Stack Developer",
      location: "San Francisco, CA",
      type: "full-time",
      description: "We're looking for an experienced full stack developer to join our growing team. You'll work on cutting-edge web applications using React, Node.js, and modern cloud technologies. The ideal candidate has 5+ years of experience and a passion for building scalable solutions.",
      skills: ["React", "Node.js", "TypeScript", "AWS", "PostgreSQL", "GraphQL"],
      deadline: new Date("2025-02-15"),
      postedBy: recruiter.id
    });

    // Create test job 2 - Pending
    const job2 = await storage.createJob({
      title: "UX/UI Designer",
      location: "Remote",
      type: "contract",
      description: "Join our design team to create beautiful and intuitive user experiences. We need someone who can take complex problems and turn them into simple, elegant solutions. Experience with Figma, user research, and design systems is essential.",
      skills: ["Figma", "User Research", "Prototyping", "Design Systems", "Adobe Creative Suite"],
      deadline: new Date("2025-01-30"),
      postedBy: recruiter.id
    });

    // Create test job 3 - Pending
    const job3 = await storage.createJob({
      title: "DevOps Engineer",
      location: "Austin, TX",
      type: "full-time",
      description: "We're seeking a DevOps engineer to help us scale our infrastructure and improve our deployment processes. You'll work with Kubernetes, Docker, and cloud platforms to ensure our applications run smoothly at scale.",
      skills: ["Kubernetes", "Docker", "AWS", "Terraform", "CI/CD", "Monitoring"],
      deadline: new Date("2025-02-28"),
      postedBy: recruiter.id
    });

    console.log('Test jobs created successfully:');
    console.log(`- ${job1.title} (ID: ${job1.id})`);
    console.log(`- ${job2.title} (ID: ${job2.id})`);
    console.log(`- ${job3.title} (ID: ${job3.id})`);
    console.log('All jobs are in "pending" status for admin review');

  } catch (error) {
    console.error('Error creating test jobs:', error);
    throw error;
  }
}