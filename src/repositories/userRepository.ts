import { Service, Inject } from 'typedi';
import { SupabaseClient } from '@supabase/supabase-js';
import { IUser, IUserInputDTO } from '@/interfaces/IUser';

@Service()
export default class UserRepository {
  constructor(@Inject('supabase') private supabase: SupabaseClient, @Inject('logger') private logger: any) {}

  public async create(userData: IUserInputDTO & { salt: string; password: string }): Promise<IUser> {
    this.logger.silly('Creating user in database');

    const { data, error } = await this.supabase.from('users').insert(userData).select().single();

    if (error) {
      this.logger.error('Error creating user: %o', error);
      throw new Error(`Failed to create user: ${error.message}`);
    }

    return data;
  }

  public async findByEmail(email: string): Promise<IUser | null> {
    this.logger.silly('Finding user by email');

    const { data, error } = await this.supabase.from('users').select('*').eq('email', email).single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "not found" error
      this.logger.error('Error finding user by email: %o', error);
      throw new Error(`Failed to find user by email: ${error.message}`);
    }

    return data;
  }

  public async findById(id: string): Promise<IUser | null> {
    this.logger.silly('Finding user by id');

    const { data, error } = await this.supabase.from('users').select('*').eq('id', id).single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "not found" error
      this.logger.error('Error finding user by id: %o', error);
      throw new Error(`Failed to find user by id: ${error.message}`);
    }

    return data;
  }

  public async update(id: string, updateData: Partial<IUser>): Promise<IUser> {
    this.logger.silly('Updating user in database');

    const { data, error } = await this.supabase.from('users').update(updateData).eq('id', id).select().single();

    if (error) {
      this.logger.error('Error updating user: %o', error);
      throw new Error(`Failed to update user: ${error.message}`);
    }

    return data;
  }
}
