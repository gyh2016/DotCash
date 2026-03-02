import type { PropsWithChildren } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const tabs = [
  { path: '/home', label: '首页' },
  { path: '/records', label: '记录' },
  { path: '/create', label: '新增' },
  { path: '/accounts', label: '账户' },
  { path: '/stats', label: '统计' },
];

export const Layout = ({ children }: PropsWithChildren) => {
  const location = useLocation();
  const isRecordsRoute = location.pathname.startsWith('/records');

  return (
    <div className="layout">
      <aside className="desktop-nav">
        <h1>点金记账</h1>
        <nav>
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) => (isActive ? 'nav-btn active' : 'nav-btn')}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className={isRecordsRoute ? 'content content-wide' : 'content'}>{children}</main>
      <nav className="mobile-nav">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) => (isActive ? 'mobile-btn active' : 'mobile-btn')}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
};
