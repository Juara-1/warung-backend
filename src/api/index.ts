import { Router } from 'express';
import auth from './routes/auth';
import user from './routes/user';

// guaranteed to get dependencies
export default (): Router => {
  const app = Router();
  auth(app);
  user(app);

  return app;
};
