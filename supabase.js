import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://nmemmfblpzrkwyljpmvp.supabase.co',
  'sb_publishable_Lc7rXKQ-1TJaQFu7a-nOVQ_5Sf3x__M'
);

/**
 * Ensures the user is signed in.
 * If not, renders a login overlay and resolves only after successful auth.
 */
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session.user;
  return new Promise((resolve) => {
    showLoginOverlay(resolve);
  });
}

function showLoginOverlay(onSuccess) {
  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.innerHTML = `
    <div class="login-box">
      <div class="login-brand">🏭 Industrial Network</div>
      <h2>Admin Sign In</h2>
      <form id="login-form">
        <label>Email
          <input type="email" id="login-email" autocomplete="email" required />
        </label>
        <label>Password
          <input type="password" id="login-password" autocomplete="current-password" required />
        </label>
        <div class="msg" id="login-msg"></div>
        <button type="submit" id="login-btn">Sign In</button>
      </form>
    </div>
  `;

  // Inline overlay styles consistent with existing dark theme
  const style = document.createElement('style');
  style.textContent = `
    #login-overlay {
      position: fixed; inset: 0;
      background: #0f172a;
      display: flex; align-items: center; justify-content: center;
      z-index: 9999;
    }
    .login-box {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 2.5rem 2rem;
      width: 100%; max-width: 380px;
    }
    .login-brand {
      font-size: 1.1rem; font-weight: 700; color: #f8fafc;
      margin-bottom: 1.5rem;
    }
    .login-box h2 {
      font-size: 1rem; font-weight: 600;
      color: #cbd5e1; margin-bottom: 1.25rem;
    }
    #login-form { display: flex; flex-direction: column; gap: 1rem; }
    #login-btn { width: 100%; justify-content: center; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const msg = document.getElementById('login-msg');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    btn.textContent = 'Signing in…';
    btn.disabled = true;
    msg.className = 'msg';
    msg.textContent = '';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      msg.className = 'msg error';
      msg.textContent = error.message;
      btn.textContent = 'Sign In';
      btn.disabled = false;
    } else {
      overlay.remove();
      onSuccess(data.user);
    }
  });
}
