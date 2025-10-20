// Database connection and utilities for admin-app

export interface User {
  id: string;
  email: string;
  name: string;
  role: "user" | "agent" | "admin";
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface File {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  uploadedAt: Date;
  processedAt?: Date;
  agentId?: string;
}

export interface Reply {
  id: string;
  fileId: string;
  agentId: string;
  message: string;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  userId: string;
  fileId: string;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAt: Date;
}

// TODO: Implement actual database connection
export class Database {
  // Placeholder methods - implement with your preferred database
  async getUsers(): Promise<User[]> {
    throw new Error("Not implemented");
  }

  async getUserById(id: string): Promise<User | null> {
    throw new Error("Not implemented");
  }

  async getFiles(): Promise<File[]> {
    throw new Error("Not implemented");
  }

  async getFileById(id: string): Promise<File | null> {
    throw new Error("Not implemented");
  }

  async updateFileStatus(id: string, status: File["status"], agentId?: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async getReplies(fileId: string): Promise<Reply[]> {
    throw new Error("Not implemented");
  }

  async createReply(replyData: Partial<Reply>): Promise<Reply> {
    throw new Error("Not implemented");
  }

  async getTransactions(): Promise<Transaction[]> {
    throw new Error("Not implemented");
  }

  async getDashboardStats(): Promise<{
    totalUsers: number;
    totalFiles: number;
    totalTransactions: number;
    pendingFiles: number;
  }> {
    throw new Error("Not implemented");
  }
}

export const db = new Database();
