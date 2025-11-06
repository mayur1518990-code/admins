"use client";

// Force dynamic rendering for authenticated pages
export const dynamic = 'force-dynamic';

import dynamicImport from "next/dynamic";
const Sidebar = dynamicImport(() => import("@/components/AdminSidebar").then(m => m.Sidebar), { ssr: false });
import { MobileHeader } from "@/components/MobileHeader";
import { useState, useEffect } from "react";

export default function SettingsPage() {
  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Check if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="mobile-app-container bg-gray-50 flex flex-col md:flex-row">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div className="flex-1 flex flex-col">
        <MobileHeader 
          title="System Settings" 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
        />
        <main className="flex-1 p-6 mobile-app-content">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 mb-6">
              System Settings
            </h1>
            
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">System settings will be configured here</p>
                <p className="text-sm text-gray-400">Configure application settings and preferences</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
