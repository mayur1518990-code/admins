(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/apps/admin-app/src/components/AdminSidebar.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Sidebar",
    ()=>Sidebar,
    "useSidebar",
    ()=>useSidebar
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature();
"use client";
;
function Sidebar() {
    let { sidebarOpen: externalSidebarOpen, setSidebarOpen: externalSetSidebarOpen } = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    _s();
    const pathname = ("TURBOPACK compile-time truthy", 1) ? window.location.pathname : "TURBOPACK unreachable";
    const userRole = typeof document !== 'undefined' ? document.cookie.includes('admin-token') ? 'admin' : document.cookie.includes('agent-token') ? 'agent' : null : null;
    const [isMobile, setIsMobile] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [internalSidebarOpen, setInternalSidebarOpen] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    // Use external state if provided, otherwise use internal state
    const sidebarOpen = externalSidebarOpen !== undefined ? externalSidebarOpen : internalSidebarOpen;
    const setSidebarOpen = externalSetSidebarOpen || setInternalSidebarOpen;
    // Check if device is mobile
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "Sidebar.useEffect": ()=>{
            const checkMobile = {
                "Sidebar.useEffect.checkMobile": ()=>{
                    const mobile = window.innerWidth < 768;
                    setIsMobile(mobile);
                    console.log('Mobile check:', mobile, 'Sidebar open:', sidebarOpen);
                }
            }["Sidebar.useEffect.checkMobile"];
            checkMobile();
            window.addEventListener('resize', checkMobile);
            return ({
                "Sidebar.useEffect": ()=>window.removeEventListener('resize', checkMobile)
            })["Sidebar.useEffect"];
        }
    }["Sidebar.useEffect"], [
        sidebarOpen
    ]);
    // Close sidebar when clicking outside on mobile
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "Sidebar.useEffect": ()=>{
            if (sidebarOpen && isMobile) {
                const handleClickOutside = {
                    "Sidebar.useEffect.handleClickOutside": (event)=>{
                        const sidebar = document.getElementById('sidebar');
                        const hamburger = document.getElementById('hamburger-menu');
                        if (sidebar && !sidebar.contains(event.target) && hamburger && !hamburger.contains(event.target)) {
                            setSidebarOpen(false);
                        }
                    }
                }["Sidebar.useEffect.handleClickOutside"];
                document.addEventListener('mousedown', handleClickOutside);
                return ({
                    "Sidebar.useEffect": ()=>document.removeEventListener('mousedown', handleClickOutside)
                })["Sidebar.useEffect"];
            }
        }
    }["Sidebar.useEffect"], [
        sidebarOpen,
        isMobile
    ]);
    const isActive = (path)=>pathname === path;
    const handleLogout = async ()=>{
        try {
            if (userRole === 'admin') {
                await fetch('/api/admin/logout', {
                    method: 'POST'
                });
            } else if (userRole === 'agent') {
                await fetch('/api/agent/logout', {
                    method: 'POST'
                });
            }
        } catch (error) {
            console.error('Logout API error:', error);
        } finally{
            document.cookie = 'admin-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            document.cookie = 'agent-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            window.location.href = '/';
        }
    };
    const adminNavigation = [
        {
            name: "Dashboard",
            href: "/",
            icon: "📊"
        },
        {
            name: "User Management",
            href: "/admin/users",
            icon: "👥"
        },
        {
            name: "Agent Management",
            href: "/admin/agents",
            icon: "🤖"
        },
        {
            name: "File Management",
            href: "/admin/files",
            icon: "📁"
        },
        {
            name: "Assignment",
            href: "/admin/assign",
            icon: "🔗"
        },
        {
            name: "Transactions",
            href: "/admin/transactions",
            icon: "💳"
        },
        {
            name: "Audit Logs",
            href: "/admin/logs",
            icon: "📋"
        },
        {
            name: "System Settings",
            href: "/admin/settings",
            icon: "⚙️"
        }
    ];
    const agentNavigation = [
        {
            name: "Dashboard",
            href: "/agent",
            icon: "📊"
        },
        {
            name: "My Files",
            href: "/agent/files",
            icon: "📁"
        },
        {
            name: "Reply",
            href: "/agent/reply",
            icon: "💬"
        }
    ];
    const navigation = userRole === 'admin' ? adminNavigation : agentNavigation;
    const portalTitle = userRole === 'admin' ? 'Admin Portal' : 'Agent Portal';
    const portalSubtitle = userRole === 'admin' ? 'Document Management System' : 'File Processing System';
    if (!userRole) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "w-64 bg-white shadow-sm border-r h-screen flex items-center justify-center flex-shrink-0",
            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "text-center",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "text-gray-400 text-4xl mb-4",
                        children: "🔒"
                    }, void 0, false, {
                        fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                        lineNumber: 96,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-gray-600",
                        children: "Please log in"
                    }, void 0, false, {
                        fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                        lineNumber: 97,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                lineNumber: 95,
                columnNumber: 9
            }, this)
        }, void 0, false, {
            fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
            lineNumber: 94,
            columnNumber: 7
        }, this);
    }
    // Always show sidebar on desktop, only hide on mobile when closed
    const shouldShowSidebar = !isMobile || sidebarOpen;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            isMobile && sidebarOpen && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "fixed inset-0 bg-black bg-opacity-50 z-40",
                onClick: ()=>setSidebarOpen(false)
            }, void 0, false, {
                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                lineNumber: 110,
                columnNumber: 9
            }, this),
            shouldShowSidebar && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                id: "sidebar",
                className: "bg-white shadow-sm border-r h-screen flex-shrink-0 ".concat(isMobile ? "fixed left-0 top-0 w-64 z-50 transition-transform duration-300 ease-in-out" : 'w-64 relative'),
                style: {
                    transform: isMobile ? sidebarOpen ? 'translateX(0)' : 'translateX(-100%)' : 'none'
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "p-6",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                className: "text-xl font-bold text-gray-900",
                                children: portalTitle
                            }, void 0, false, {
                                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                lineNumber: 130,
                                columnNumber: 9
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "text-sm text-gray-500 mt-1",
                                children: portalSubtitle
                            }, void 0, false, {
                                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                lineNumber: 131,
                                columnNumber: 9
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "mt-2",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ".concat(userRole === 'admin' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'),
                                    children: userRole === 'admin' ? '👑 Admin' : '🤖 Agent'
                                }, void 0, false, {
                                    fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                    lineNumber: 133,
                                    columnNumber: 11
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                lineNumber: 132,
                                columnNumber: 9
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                        lineNumber: 129,
                        columnNumber: 7
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
                        className: "mt-6",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "px-6 py-2",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h3", {
                                    className: "text-xs font-semibold text-gray-500 uppercase tracking-wider",
                                    children: userRole === 'admin' ? 'Management' : 'Work'
                                }, void 0, false, {
                                    fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                    lineNumber: 145,
                                    columnNumber: 11
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                lineNumber: 144,
                                columnNumber: 9
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "mt-2",
                                children: navigation.map((item)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                                        href: item.href,
                                        onClick: ()=>{
                                            if (isMobile) {
                                                setSidebarOpen(false);
                                            }
                                        },
                                        className: "flex items-center px-6 py-3 text-sm font-medium transition-colors ".concat(isActive(item.href) ? "bg-blue-50 text-blue-700 border-r-2 border-blue-700" : "text-gray-700 hover:bg-gray-50"),
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "text-lg mr-3",
                                                children: item.icon
                                            }, void 0, false, {
                                                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                                lineNumber: 166,
                                                columnNumber: 15
                                            }, this),
                                            item.name
                                        ]
                                    }, item.name, true, {
                                        fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                        lineNumber: 152,
                                        columnNumber: 13
                                    }, this))
                            }, void 0, false, {
                                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                lineNumber: 150,
                                columnNumber: 9
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "mt-8 px-6",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                    onClick: handleLogout,
                                    className: "w-full flex items-center px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "text-lg mr-3",
                                            children: "🚪"
                                        }, void 0, false, {
                                            fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                            lineNumber: 178,
                                            columnNumber: 13
                                        }, this),
                                        "Logout"
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                    lineNumber: 174,
                                    columnNumber: 11
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                                lineNumber: 173,
                                columnNumber: 9
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                        lineNumber: 143,
                        columnNumber: 7
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/admin-app/src/components/AdminSidebar.tsx",
                lineNumber: 118,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true);
}
_s(Sidebar, "vuz/NJcRym0BeYmKG7oyJOkAOho=");
_c = Sidebar;
function useSidebar() {
    _s1();
    const [sidebarOpen, setSidebarOpen] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [isMobile, setIsMobile] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useSidebar.useEffect": ()=>{
            const checkMobile = {
                "useSidebar.useEffect.checkMobile": ()=>{
                    setIsMobile(window.innerWidth < 768);
                }
            }["useSidebar.useEffect.checkMobile"];
            checkMobile();
            window.addEventListener('resize', checkMobile);
            return ({
                "useSidebar.useEffect": ()=>window.removeEventListener('resize', checkMobile)
            })["useSidebar.useEffect"];
        }
    }["useSidebar.useEffect"], []);
    return {
        sidebarOpen,
        setSidebarOpen,
        isMobile
    };
}
_s1(useSidebar, "t81dZI5RZ6QJuM+LOdIT88ADgtA=");
var _c;
__turbopack_context__.k.register(_c, "Sidebar");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/apps/admin-app/src/components/AdminSidebar.tsx [app-client] (ecmascript, next/dynamic entry)", ((__turbopack_context__) => {

__turbopack_context__.n(__turbopack_context__.i("[project]/apps/admin-app/src/components/AdminSidebar.tsx [app-client] (ecmascript)"));
}),
]);

//# sourceMappingURL=apps_admin-app_src_components_AdminSidebar_tsx_f760599a._.js.map