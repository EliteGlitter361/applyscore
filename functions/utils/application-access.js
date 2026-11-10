import {effectiveAdminPermissions} from './accounts.js';

export function canViewApplication(app, session) {
  if (app.status === 'approved') return true;
  if (session?.state !== 'online') return false;
  if (session.row.kind === 'student') return String(app.packageName) === session.row.id;
  return session.row.kind === 'admin' && effectiveAdminPermissions(session.account, session.accounts).auditPermission;
}
