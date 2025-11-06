export interface Alert {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface CreateAlertDTO {
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  isActive: boolean;
}

