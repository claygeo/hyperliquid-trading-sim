import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { wsClient } from '../lib/websocket';
import type { User, Profile, AuthState } from '../types/user';

// Generate a fake email from username for Supabase auth
const usernameToEmail = (username: string) => `${username.toLowerCase()}@hypersim.local`;

interface AuthStore extends AuthState {
  initialize: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      initialize: async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          
          if (session?.access_token) {
            api.setToken(session.access_token);
            wsClient.setToken(session.access_token);
            
            const { data: profile } = await supabase
              .from('profiles')
              .select('*')
              .eq('user_id', session.user.id)
              .single();

            set({
              user: {
                id: session.user.id,
                email: session.user.email!,
                username: profile?.username || 'trader',
                createdAt: session.user.created_at,
              },
              profile: profile || null,
              isAuthenticated: true,
              isLoading: false,
            });
          } else {
            set({ isLoading: false });
          }
        } catch (error) {
          console.error('Auth initialization error:', error);
          set({ isLoading: false });
        }

        // Listen for auth changes
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_OUT') {
            api.setToken(null);
            wsClient.setToken(null);
            set({ user: null, profile: null, isAuthenticated: false });
          } else if (event === 'SIGNED_IN' && session) {
            api.setToken(session.access_token);
            wsClient.setToken(session.access_token);
          }
        });
      },

      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const email = usernameToEmail(username);
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error) {
            if (error.message.includes('Invalid login credentials')) {
              throw new Error('Invalid username or password');
            }
            throw error;
          }

          if (data.session) {
            api.setToken(data.session.access_token);
            wsClient.setToken(data.session.access_token);

            const { data: profile } = await supabase
              .from('profiles')
              .select('*')
              .eq('user_id', data.user.id)
              .single();

            set({
              user: {
                id: data.user.id,
                email: data.user.email!,
                username: profile?.username || username,
                createdAt: data.user.created_at,
              },
              profile: profile || null,
              isAuthenticated: true,
              isLoading: false,
            });
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Login failed',
            isLoading: false,
          });
          throw error;
        }
      },

      register: async (username: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const email = usernameToEmail(username);
          
          // Check if username already exists
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('username')
            .eq('username', username.toLowerCase())
            .single();

          if (existingProfile) {
            throw new Error('Username already taken');
          }

          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { username },
            },
          });

          if (error) throw error;

          if (data.user) {
            // Create profile
            const { error: profileError } = await supabase.from('profiles').insert({
              user_id: data.user.id,
              username: username.toLowerCase(),
            });

            if (profileError) {
              console.error('Profile creation error:', profileError);
            }

            // Create account with initial balance
            const { error: accountError } = await supabase.from('accounts').insert({
              user_id: data.user.id,
              balance: 100000,
              initial_balance: 100000,
            });

            if (accountError) {
              console.error('Account creation error:', accountError);
            }

            if (data.session) {
              api.setToken(data.session.access_token);
              wsClient.setToken(data.session.access_token);

              set({
                user: {
                  id: data.user.id,
                  email: data.user.email!,
                  username,
                  createdAt: data.user.created_at,
                },
                profile: {
                  id: data.user.id,
                  userId: data.user.id,
                  username,
                  createdAt: new Date().toISOString(),
                },
                isAuthenticated: true,
                isLoading: false,
              });
            }
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Registration failed',
            isLoading: false,
          });
          throw error;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          await supabase.auth.signOut();
          api.setToken(null);
          wsClient.setToken(null);
          wsClient.disconnect();
          set({
            user: null,
            profile: null,
            isAuthenticated: false,
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      setError: (error: string | null) => set({ error }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        profile: state.profile,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
