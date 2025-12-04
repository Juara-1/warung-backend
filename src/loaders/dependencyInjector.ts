import { Container } from 'typedi';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import LoggerInstance from './logger';
import UserRepository from '@/repositories/userRepository';
import config from '@/config';

export default ({ supabaseClient }: { supabaseClient: any }) => {
  try {
    const mgInstance = new Mailgun(formData);

    Container.set('supabase', supabaseClient);
    Container.set('userRepository', UserRepository);
    Container.set('logger', LoggerInstance);
    Container.set('emailClient', mgInstance.client({ key: config.emails.apiKey, username: config.emails.apiUsername }));
    Container.set('emailDomain', config.emails.domain);

    LoggerInstance.info('✌️ Supabase injected into container');
    LoggerInstance.info('✌️ UserRepository injected into container');
  } catch (e) {
    LoggerInstance.error('🔥 Error on dependency injector loader: %o', e);
    throw e;
  }
};
