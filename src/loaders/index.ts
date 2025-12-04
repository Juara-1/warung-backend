import { Application } from 'express';
import expressLoader from './express';
import dependencyInjectorLoader from './dependencyInjector';
import supabaseLoader from './supabase';
import Logger from './logger';
//We have to import at least all the events once so they can be triggered
import './events';

export default async ({ expressApp }: { expressApp: Application }): Promise<void> => {
  const supabaseClient = await supabaseLoader();
  Logger.info('✌️ Supabase client loaded!');

  /**
   * We are injecting repositories into the DI container.
   * This provides a lot of flexibility at the time of writing unit tests.
   */

  await dependencyInjectorLoader({
    supabaseClient,
  });
  Logger.info('✌️ Dependency Injector loaded');

  await expressLoader({ app: expressApp });
  Logger.info('✌️ Express loaded');
};
