export interface IUser {
  id: string;
  name: string;
  email: string;
  password: string;
  salt: string;
  role?: string;
  created_at?: string;
  updated_at?: string;
  lastLogin?: Date;
}

export interface IUserInputDTO {
  name: string;
  email: string;
  password: string;
}
