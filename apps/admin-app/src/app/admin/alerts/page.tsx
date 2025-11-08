"use client";

// Force dynamic rendering for authenticated pages
export const dynamic = 'force-dynamic';

import dynamicImport from "next/dynamic";
const Sidebar = dynamicImport(() => import("@/components/AdminSidebar").then(m => m.Sidebar), { ssr: false });
import { MobileHeader } from "@/components/MobileHeader";
import { useState, useEffect } from "react";

interface Alert {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface ContactNumbersSettings {
  contactNumbers: string[];
  isActive: boolean;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [type, setType] = useState<'info' | 'warning' | 'success' | 'error'>('info');
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Contact numbers state
  const [contactNumbers, setContactNumbers] = useState<string[]>([]);
  const [contactNumbersActive, setContactNumbersActive] = useState(true);
  const [newContactNumber, setNewContactNumber] = useState("");
  const [savingContactNumbers, setSavingContactNumbers] = useState(false);
  const [defaultTimerMinutes, setDefaultTimerMinutes] = useState(10);

  // Fetch alerts
  const fetchAlerts = async () => {
    try {
      const response = await fetch("/api/admin/alerts");
      if (response.ok) {
        const data = await response.json();
        setAlerts(data.alerts || []);
      }
    } catch (error) {
      console.error("Error fetching alerts:", error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch contact numbers
  const fetchContactNumbers = async () => {
    try {
      const response = await fetch("/api/admin/contact-numbers");
      if (response.ok) {
        const data = await response.json();
        setContactNumbers(data.contactNumbers || []);
        setContactNumbersActive(data.isActive ?? true);
      }
    } catch (error) {
      console.error("Error fetching contact numbers:", error);
    }
  };

  // Fetch settings
  const fetchSettings = async () => {
    try {
      const response = await fetch("/api/admin/settings");
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.settings) {
          setDefaultTimerMinutes(data.settings.defaultEditTimerMinutes || 10);
        }
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    }
  };

  useEffect(() => {
    fetchAlerts();
    fetchContactNumbers();
    fetchSettings();
  }, []);

  // Create alert
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, type, isActive }),
      });

      if (response.ok) {
        setMessage("");
        setType('info');
        setIsActive(true);
        fetchAlerts();
        alert("Alert created successfully!");
      } else {
        alert("Failed to create alert");
      }
    } catch (error) {
      console.error("Error creating alert:", error);
      alert("Error creating alert");
    } finally {
      setSubmitting(false);
    }
  };

  // Delete alert
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this alert?")) return;

    try {
      const response = await fetch(`/api/admin/alerts?id=${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        fetchAlerts();
        alert("Alert deleted successfully!");
      } else {
        alert("Failed to delete alert");
      }
    } catch (error) {
      console.error("Error deleting alert:", error);
      alert("Error deleting alert");
    }
  };

  // Toggle active status
  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const response = await fetch("/api/admin/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive: !currentStatus }),
      });

      if (response.ok) {
        fetchAlerts();
      } else {
        alert("Failed to update alert");
      }
    } catch (error) {
      console.error("Error updating alert:", error);
      alert("Error updating alert");
    }
  };

  // Add contact number
  const handleAddContactNumber = () => {
    if (!newContactNumber.trim()) return;
    
    // Basic phone number validation
    const phoneRegex = /^[+\d\s()-]+$/;
    if (!phoneRegex.test(newContactNumber)) {
      alert("Please enter a valid phone number");
      return;
    }
    
    setContactNumbers([...contactNumbers, newContactNumber.trim()]);
    setNewContactNumber("");
  };

  // Remove contact number
  const handleRemoveContactNumber = (index: number) => {
    setContactNumbers(contactNumbers.filter((_, i) => i !== index));
  };

  // Save contact numbers
  const handleSaveContactNumbers = async () => {
    setSavingContactNumbers(true);
    try {
      const response = await fetch("/api/admin/contact-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          contactNumbers, 
          isActive: contactNumbersActive 
        }),
      });

      if (response.ok) {
        alert("Contact numbers saved successfully!");
      } else {
        alert("Failed to save contact numbers");
      }
    } catch (error) {
      console.error("Error saving contact numbers:", error);
      alert("Error saving contact numbers");
    } finally {
      setSavingContactNumbers(false);
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'info': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'success': return 'bg-green-100 text-green-800 border-green-200';
      case 'error': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'info': return 'ℹ️';
      case 'warning': return '⚠️';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return 'ℹ️';
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <MobileHeader title="Alerts" onMenuClick={() => setSidebarOpen(true)} />
        
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 lg:p-8">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Alert Management</h1>
              <p className="mt-2 text-sm text-gray-600">
                Create and manage alerts that will be displayed on the user app home page
              </p>
            </div>

            {/* Create Alert Form */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Create New Alert</h2>
              <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Alert Message
                    </label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Enter your alert message here..."
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows={3}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Alert Type
                      </label>
                      <select
                        value={type}
                        onChange={(e) => setType(e.target.value as any)}
                        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="info">ℹ️ Info</option>
                        <option value="warning">⚠️ Warning</option>
                        <option value="success">✅ Success</option>
                        <option value="error">❌ Error</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Status
                      </label>
                      <select
                        value={isActive ? 'active' : 'inactive'}
                        onChange={(e) => setIsActive(e.target.value === 'active')}
                        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                  >
                    {submitting ? "Creating..." : "Create Alert"}
                  </button>
                </div>
              </form>
            </div>

            {/* File Edit Timer Settings Section */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">File Edit Timer Settings</h2>
              <p className="text-sm text-gray-600 mb-4">
                Set the default edit timer duration. When an agent uploads a completed file, users will automatically be able to edit the file for this duration. Timer starts automatically when the completed file becomes visible to the user.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Default Edit Timer Duration
                  </label>
                  <select
                    id="defaultTimerMinutes"
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    value={defaultTimerMinutes}
                    onChange={async (e) => {
                      const timerMinutes = parseInt(e.target.value);
                      
                      try {
                        const response = await fetch('/api/admin/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ defaultEditTimerMinutes: timerMinutes }),
                        });
                        
                        const result = await response.json();
                        if (result.success) {
                          setDefaultTimerMinutes(timerMinutes);
                          alert(`Timer duration updated to ${timerMinutes} minutes! This will apply to all newly completed files.`);
                        } else {
                          alert(`Failed to update timer: ${result.error}`);
                        }
                      } catch (error) {
                        console.error('Error updating timer:', error);
                        alert('Error updating timer');
                      }
                    }}
                  >
                    <option value="5">5 minutes</option>
                    <option value="10">10 minutes</option>
                    <option value="15">15 minutes</option>
                    <option value="20">20 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="120">2 hours</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-2">
                    This timer will automatically start when an agent uploads a completed file and it becomes visible to the user.
                  </p>
                </div>
              </div>
            </div>

            {/* Contact Numbers Section */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Contact Numbers</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    These numbers will be shown to users when their files are in processing status
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <label className="text-sm font-medium text-gray-700">Show to Users:</label>
                  <button
                    onClick={() => setContactNumbersActive(!contactNumbersActive)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      contactNumbersActive ? 'bg-green-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        contactNumbersActive ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Add new contact number */}
              <div className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={newContactNumber}
                    onChange={(e) => setNewContactNumber(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddContactNumber()}
                    placeholder="Enter phone number (e.g., +1 234 567 8900)"
                    className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleAddContactNumber}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Contact numbers list */}
              {contactNumbers.length === 0 ? (
                <div className="text-center py-6 text-gray-500 border-2 border-dashed rounded-lg">
                  No contact numbers added yet. Add phone numbers above.
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  {contactNumbers.map((number, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-gray-50 border rounded-lg p-3"
                    >
                      <div className="flex items-center space-x-3">
                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        <span className="font-medium text-gray-900">{number}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveContactNumber(index)}
                        className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                        title="Remove"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Save button */}
              <button
                onClick={handleSaveContactNumbers}
                disabled={savingContactNumbers}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
              >
                {savingContactNumbers ? "Saving..." : "Save Contact Numbers"}
              </button>
            </div>

            {/* Alerts List */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4">Active Alerts</h2>
              
              {loading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="mt-2 text-gray-600">Loading alerts...</p>
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No alerts yet. Create your first alert above!
                </div>
              ) : (
                <div className="space-y-4">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`border rounded-lg p-4 ${getTypeColor(alert.type)}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xl">{getTypeIcon(alert.type)}</span>
                            <span className="font-semibold capitalize">{alert.type}</span>
                            <span className={`px-2 py-1 rounded text-xs ${
                              alert.isActive 
                                ? 'bg-green-200 text-green-800' 
                                : 'bg-gray-200 text-gray-600'
                            }`}>
                              {alert.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="mb-2">{alert.message}</p>
                          <p className="text-xs opacity-75">
                            Created: {new Date(alert.createdAt).toLocaleString()}
                          </p>
                        </div>
                        
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => handleToggleActive(alert.id, alert.isActive)}
                            className="px-3 py-1 bg-white rounded border hover:bg-gray-50 text-sm"
                            title={alert.isActive ? "Deactivate" : "Activate"}
                          >
                            {alert.isActive ? '⏸️' : '▶️'}
                          </button>
                          <button
                            onClick={() => handleDelete(alert.id)}
                            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

