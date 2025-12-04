import { Container } from 'typedi';
import { IUser } from '@/interfaces/IUser';
import { Logger } from 'winston';
import UserRepository from '@/repositories/userRepository';

/**
 * Attach user to req.currentUser
 * @param {*} req Express req Object
 * @param {*} res  Express res Object
 * @param {*} next  Express next Function
 */
const attachCurrentUser = async (req, res, next) => {
  const Logger : Logger = Container.get('logger');
  try {
    const userRepository = Container.get('userRepository') as UserRepository;
    const userRecord = await userRepository.findById(req.token.id);
    if (!userRecord) {
      return res.sendStatus(401);
    }
    const currentUser = { ...userRecord };
    Reflect.deleteProperty(currentUser, 'password');
    Reflect.deleteProperty(currentUser, 'salt');
    req.currentUser = currentUser;
    return next();
  } catch (e) {
    Logger.error('🔥 Error attaching user to req: %o', e);
    return next(e);
  }
};

export default attachCurrentUser;
