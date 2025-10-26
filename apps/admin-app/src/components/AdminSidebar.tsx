"use client";

import { useState, useEffect } from 'react';

interface SidebarProps {
  sidebarOpen?: boolean;
  setSidebarOpen?: (open: boolean) => void;
}

export function Sidebar({ sidebarOpen: externalSidebarOpen, setSidebarOpen: externalSetSidebarOpen }: SidebarProps = {}) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : "";
  const userRole: 'admin' | 'agent' | null = typeof document !== 'undefined'
    ? (document.cookie.includes('admin-token') ? 'admin' : document.cookie.includes('agent-token') ? 'agent' : null)
    : null;
  
  const [isMobile, setIsMobile] = useState(false);
  const [internalSidebarOpen, setInternalSidebarOpen] = useState(false);
  
  // Use external state if provided, otherwise use internal state
  const sidebarOpen = externalSidebarOpen !== undefined ? externalSidebarOpen : internalSidebarOpen;
  const setSidebarOpen = externalSetSidebarOpen || setInternalSidebarOpen;

  // Check if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      console.log('Mobile check:', mobile, 'Sidebar open:', sidebarOpen);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [sidebarOpen]);

  // Close sidebar when clicking outside on mobile
  useEffect(() => {
    if (sidebarOpen && isMobile) {
      const handleClickOutside = (event: MouseEvent) => {
        const sidebar = document.getElementById('sidebar');
        const hamburger = document.getElementById('hamburger-menu');
        if (sidebar && !sidebar.contains(event.target as Node) && 
            hamburger && !hamburger.contains(event.target as Node)) {
          setSidebarOpen(false);
        }
      };
      
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [sidebarOpen, isMobile]);

  const isActive = (path: string) => pathname === path;

  const handleLogout = async () => {
    try {
      if (userRole === 'admin') {
        await fetch('/api/admin/logout', { method: 'POST' });
      } else if (userRole === 'agent') {
        await fetch('/api/agent/logout', { method: 'POST' });
      }
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      document.cookie = 'admin-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'agent-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      window.location.href = '/';
    }
  };

  const adminNavigation = [
    { name: "Dashboard", href: "/", icon: "📊" },
    { name: "User Management", href: "/admin/users", icon: "👥" },
    { name: "Agent Management", href: "/admin/agents", icon: "🤖" },
    { name: "File Management", href: "/admin/files", icon: "📁" },
    { name: "Assignment", href: "/admin/assign", icon: "🔗" },
    { name: "Transactions", href: "/admin/transactions", icon: "💳" },
    { name: "Audit Logs", href: "/admin/logs", icon: "📋" },
    { name: "System Settings", href: "/admin/settings", icon: "⚙️" },
  ];

  const agentNavigation = [
    { name: "Dashboard", href: "/agent", icon: "📊" },
    { name: "My Files", href: "/agent/files", icon: "📁" },
    { name: "Reply", href: "/agent/reply", icon: "💬" },
  ];

  const navigation = userRole === 'admin' ? adminNavigation : agentNavigation;
  const portalTitle = userRole === 'admin' ? 'Admin Portal' : 'Agent Portal';
  const portalSubtitle = userRole === 'admin' ? 'Document Management System' : 'File Processing System';

  if (!userRole) {
    return (
      <div className="w-64 bg-white shadow-sm border-r h-screen flex items-center justify-center flex-shrink-0">
        <div className="text-center">
          <div className="text-gray-400 text-4xl mb-4">🔒</div>
          <p className="text-gray-600">Please log in</p>
        </div>
      </div>
    );
  }

  // Always show sidebar on desktop, only hide on mobile when closed
  const shouldShowSidebar = !isMobile || sidebarOpen;

  return (
    <>
      {/* Mobile Overlay */}
      {isMobile && sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      {shouldShowSidebar && (
        <div 
          id="sidebar"
          className={`bg-white shadow-sm border-r h-screen flex-shrink-0 ${
            isMobile 
              ? `fixed left-0 top-0 w-64 z-50 transition-transform duration-300 ease-in-out`
              : 'w-64 relative'
          }`}
          style={{
            transform: isMobile ? (sidebarOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none'
          }}
        >
      <div className="p-6">
        <h2 className="text-xl font-bold text-gray-900">{portalTitle}</h2>
        <p className="text-sm text-gray-500 mt-1">{portalSubtitle}</p>
        <div className="mt-2">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            userRole === 'admin' 
              ? 'bg-red-100 text-red-800' 
              : 'bg-blue-100 text-blue-800'
          }`}>
            {userRole === 'admin' ? '👑 Admin' : '🤖 Agent'}
          </span>
        </div>
      </div>
      
      <nav className="mt-6">
        <div className="px-6 py-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {userRole === 'admin' ? 'Management' : 'Work'}
          </h3>
        </div>
        
        <div className="mt-2">
          {navigation.map((item) => (
            <a
              key={item.name}
              href={item.href}
              onClick={() => {
                if (isMobile) {
                  setSidebarOpen(false);
                }
              }}
              className={`flex items-center px-6 py-3 text-sm font-medium transition-colors ${
                isActive(item.href) 
                  ? "bg-blue-50 text-blue-700 border-r-2 border-blue-700" 
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <span className="text-lg mr-3">{item.icon}</span>
              {item.name}
            </a>
          ))}
        </div>

        {/* Logout Button */}
        <div className="mt-8 px-6">
          <button
            onClick={handleLogout}
            className="w-full flex items-center px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
          >
            <span className="text-lg mr-3">🚪</span>
            Logout
          </button>
        </div>
      </nav>
        </div>
      )}
    </>
  );
}

// Export the sidebar state and toggle function for use in other components
export function useSidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return { sidebarOpen, setSidebarOpen, isMobile };
}


