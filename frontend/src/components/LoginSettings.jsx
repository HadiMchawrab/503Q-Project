import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function LoginSettings() {
  const { user, logout } = useAuth()
  const [editing, setEditing] = useState(null) // 'email' | 'password' | null
  const [saved, setSaved] = useState(null)
  const [newEmail, setNewEmail] = useState(user?.email || '')
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState(null)

  const handleSaveEmail = () => {
    // In a real app this would call PATCH /api/auth/email
    setSaved('Email updated successfully')
    setEditing(null)
    setTimeout(() => setSaved(null), 4000)
  }

  const handleSavePassword = () => {
    if (passwords.next !== passwords.confirm) {
      setPwError('New passwords do not match.')
      return
    }
    if (passwords.next.length < 8) {
      setPwError('Password must be at least 8 characters.')
      return
    }
    setPwError(null)
    // In a real app this would call PATCH /api/auth/password
    setSaved('Password updated successfully')
    setEditing(null)
    setPasswords({ current: '', next: '', confirm: '' })
    setTimeout(() => setSaved(null), 4000)
  }

  return (
    <div className="acc-section">
      <h2 className="acc-section-title">Login &amp; Security</h2>

      {saved && <div className="acc-toast">{saved}</div>}

      <div className="settings-card">
        {/* Name */}
        <div className="settings-row">
          <div>
            <div className="settings-field-label">Name</div>
            <div className="settings-field-value">{user?.name || '—'}</div>
          </div>
        </div>

        {/* Email */}
        <div className="settings-row">
          <div className="settings-row-body">
            <div className="settings-field-label">Email</div>
            {editing === 'email' ? (
              <div className="settings-edit">
                <input
                  type="email"
                  className="settings-input"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="New email address"
                />
                <div className="settings-actions">
                  <button className="settings-save-btn" onClick={handleSaveEmail}>Save</button>
                  <button className="settings-cancel-btn" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="settings-field-row">
                <span className="settings-field-value">{user?.email || '—'}</span>
                <button className="settings-edit-btn" onClick={() => setEditing('email')}>Edit</button>
              </div>
            )}
          </div>
        </div>

        {/* Password */}
        <div className="settings-row">
          <div className="settings-row-body">
            <div className="settings-field-label">Password</div>
            {editing === 'password' ? (
              <div className="settings-edit">
                <input
                  type="password"
                  className="settings-input"
                  placeholder="Current password"
                  value={passwords.current}
                  onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))}
                />
                <input
                  type="password"
                  className="settings-input"
                  placeholder="New password"
                  value={passwords.next}
                  onChange={e => setPasswords(p => ({ ...p, next: e.target.value }))}
                />
                <input
                  type="password"
                  className="settings-input"
                  placeholder="Confirm new password"
                  value={passwords.confirm}
                  onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                />
                {pwError && <p className="settings-pw-error">{pwError}</p>}
                <div className="settings-actions">
                  <button className="settings-save-btn" onClick={handleSavePassword}>Save</button>
                  <button className="settings-cancel-btn" onClick={() => { setEditing(null); setPwError(null) }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="settings-field-row">
                <span className="settings-field-value">••••••••</span>
                <button className="settings-edit-btn" onClick={() => setEditing('password')}>Edit</button>
              </div>
            )}
          </div>
        </div>

        {/* 2FA */}
        <div className="settings-row">
          <div>
            <div className="settings-field-label">Two-Factor Authentication</div>
            <div className="settings-field-value">Not enabled</div>
          </div>
          <button className="settings-edit-btn">Enable</button>
        </div>
      </div>

      <div className="settings-danger">
        <h3>Sign Out</h3>
        <p>Sign out of your account on this device.</p>
        <button className="settings-signout-btn" onClick={logout}>Sign Out</button>
      </div>
    </div>
  )
}
