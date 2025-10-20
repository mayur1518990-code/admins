"use client";

import React from "react";

interface DashboardData {
  overview: {
    totalUsers: number;
    activeUsers: number;
    newUsers: number;
    totalAgents: number;
    activeAgents: number;
    newAgents: number;
    totalFiles: number;
    newFiles: number;
    unassignedFiles: number;
    totalPayments: number;
    successfulPayments: number;
    newPayments: number;
    totalRevenue: number;
    newRevenue: number;
  };
  files: {
    total: number;
    byStatus: Record<string, number>;
    new: number;
    unassigned: number;
    completionRate: string;
  };
  payments: {
    total: number;
    successful: number;
    new: number;
    totalRevenue: number;
    newRevenue: number;
    successRate: string;
  };
  agents: {
    total: number;
    active: number;
    new: number;
    performance: Array<{
      id: string;
      name: string;
      email: string;
      totalFiles: number;
      completedFiles: number;
      pendingFiles: number;
      completionRate: string;
    }>;
  };
}

interface DashboardStatsProps {
  data: DashboardData;
}

export const DashboardStats = React.memo(function DashboardStats({ data }: DashboardStatsProps) {
  const formatCurrency = React.useCallback((amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amount);
  }, []);

  const formatPercentage = React.useCallback((value: string) => {
    return `${value}%`;
  }, []);

  const statCards = React.useMemo(() => [
    {
      title: "Total Users",
      value: data.overview.totalUsers,
      subtitle: `${data.overview.activeUsers} active`,
      change: `+${data.overview.newUsers} new`,
      color: "bg-blue-500",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      )
    },
    {
      title: "Total Agents",
      value: data.overview.totalAgents,
      subtitle: `${data.overview.activeAgents} active`,
      change: `+${data.overview.newAgents} new`,
      color: "bg-green-500",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      title: "Total Files",
      value: data.overview.totalFiles,
      subtitle: `${data.overview.unassignedFiles} unassigned`,
      change: `+${data.overview.newFiles} new`,
      color: "bg-purple-500",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    },
    {
      title: "Total Revenue",
      value: formatCurrency(data.overview.totalRevenue),
      subtitle: `${data.payments.successRate} success rate`,
      change: `+${formatCurrency(data.overview.newRevenue)} new`,
      color: "bg-yellow-500",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
        </svg>
      )
    }
  ], [data, formatCurrency]);

  return (
    <div className="space-y-6">
      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center">
              <div className={`${stat.color} text-white rounded-lg p-3 mr-4`}>
                {stat.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-500">{stat.title}</p>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-xs text-gray-500 mt-1">{stat.subtitle}</p>
                <p className="text-xs text-green-600 mt-1">{stat.change}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Files Status Breakdown */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Files Status</h3>
          <div className="space-y-3">
            {Object.entries(data.files.byStatus).map(([status, count]) => (
              <div key={status} className="flex justify-between items-center">
                <span className="text-sm text-gray-600 capitalize">{status.replace('_', ' ')}</span>
                <span className="text-sm font-medium text-gray-900">{count}</span>
              </div>
            ))}
            <div className="border-t pt-3 mt-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-900">Completion Rate</span>
                <span className="text-sm font-medium text-green-600">{data.files.completionRate}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Stats */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment Stats</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Total Payments</span>
              <span className="text-sm font-medium text-gray-900">{data.payments.total}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Successful</span>
              <span className="text-sm font-medium text-green-600">{data.payments.successful}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Success Rate</span>
              <span className="text-sm font-medium text-green-600">{data.payments.successRate}%</span>
            </div>
            <div className="border-t pt-3 mt-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-900">New Revenue</span>
                <span className="text-sm font-medium text-green-600">{formatCurrency(data.payments.newRevenue)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Agent Performance */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Agents</h3>
          <div className="space-y-3">
            {data.agents.performance.slice(0, 3).map((agent) => (
              <div key={agent.id} className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                  <p className="text-xs text-gray-500">{agent.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{agent.completedFiles}/{agent.totalFiles}</p>
                  <p className="text-xs text-green-600">{agent.completionRate}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
