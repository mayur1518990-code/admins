"use client";

import React from "react";
import Link from "next/link";

export const QuickActions = React.memo(function QuickActions() {
  const quickActions = React.useMemo(() => [
    {
      title: "Add New Agent",
      description: "Create a new agent account",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
      ),
      href: "/admin/agents",
      color: "bg-blue-500 hover:bg-blue-600",
      action: "create"
    },
    {
      title: "Assign Files",
      description: "Manually assign files to agents",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      href: "/admin/assign",
      color: "bg-green-500 hover:bg-green-600",
      action: "assign"
    },
    {
      title: "View Transactions",
      description: "Check payment logs and revenue",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
      href: "/admin/transactions",
      color: "bg-purple-500 hover:bg-purple-600",
      action: "transactions"
    },
    {
      title: "Export Logs",
      description: "Download system logs and reports",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      href: "/admin/logs",
      color: "bg-yellow-500 hover:bg-yellow-600",
      action: "export"
    }
  ], []);

  const handleQuickAction = React.useCallback(async (action: string) => {
    switch (action) {
      case 'create':
        break;
      case 'assign':
        break;
      case 'transactions':
        break;
      case 'export':
        break;
    }
  }, []);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {quickActions.map((action, index) => (
          <Link
            key={index}
            href={action.href}
            className="group block p-4 rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all duration-200"
            onClick={() => handleQuickAction(action.action)}
          >
            <div className="flex items-start space-x-3">
              <div className={`${action.color} text-white rounded-lg p-2 group-hover:scale-110 transition-transform duration-200`}>
                {action.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-gray-900 group-hover:text-gray-700">
                  {action.title}
                </h4>
                <p className="text-xs text-gray-500 mt-1">
                  {action.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
      
      <div className="mt-6 pt-4 border-t border-gray-200">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">24</div>
            <div className="text-xs text-gray-500">Pending Files</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">8</div>
            <div className="text-xs text-gray-500">Active Agents</div>
          </div>
        </div>
      </div>
    </div>
  );
});
