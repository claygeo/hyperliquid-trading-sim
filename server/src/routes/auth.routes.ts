import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validation.middleware.js';
import { getSupabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { TRADING_CONSTANTS } from '../config/constants.js';

export const authRoutes = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  username: z.string().min(3).max(20),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRoutes.post('/register', validateBody(registerSchema), async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const supabase = getSupabase();

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });

    if (authError) {
      logger.error('Auth error:', authError);
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // Create profile
    await supabase.from('profiles').insert({
      id: uuidv4(),
      user_id: userId,
      username,
    });

    // Create account
    await supabase.from('accounts').insert({
      id: uuidv4(),
      user_id: userId,
      balance: TRADING_CONSTANTS.INITIAL_BALANCE,
      initial_balance: TRADING_CONSTANTS.INITIAL_BALANCE,
      reset_count: 0,
    });

    // Create leaderboard stats entry
    await supabase.from('leaderboard_stats').insert({
      id: uuidv4(),
      user_id: userId,
      total_pnl: 0,
      total_pnl_percent: 0,
      win_rate: 0,
      max_drawdown: 0,
      trade_count: 0,
    });

    // Generate session
    await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    res.status(201).json({
      user: { id: userId, email },
      message: 'Account created successfully',
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

authRoutes.post('/login', validateBody(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const supabase = getSupabase();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      user: { id: data.user.id, email: data.user.email },
      token: data.session.access_token,
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});
