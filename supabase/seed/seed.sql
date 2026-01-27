-- Seed file for development/testing
-- This creates sample data for the trading simulator

-- Note: In production, users would register through the auth system
-- This is just for testing purposes

-- Sample leaderboard data (these would be created when real users trade)
-- INSERT INTO leaderboard_stats (user_id, total_pnl, total_pnl_percent, win_rate, max_drawdown, trade_count)
-- VALUES 
--   ('uuid-here', 15000, 15.00, 65.5, 8.2, 42),
--   ('uuid-here', 8500, 8.50, 58.3, 12.1, 28);

-- This file is intentionally minimal as most data is created through user actions
SELECT 'Seed file executed successfully' as message;
