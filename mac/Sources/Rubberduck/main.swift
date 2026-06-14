import AppKit
import UserNotifications

/// Standalone desktop app: double-click to launch, opens its own window with the
/// dashboard (an embedded web view — never your browser). Owns the local server
/// process, shows native notifications when a session needs you, and quits when
/// you close the window.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let server = ServerProcess()
    private var poller: SessionPoller?
    private var window: DashboardWindow?
    private var notified = Set<String>()  // waiting keys we've already alerted on

    func applicationDidFinishLaunching(_ note: Notification) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }

        window = DashboardWindow(url: server.url)
        window?.show()  // open the dashboard window on launch
        NSApp.activate(ignoringOtherApps: true)

        Task {
            _ = await server.start()  // start the server, or attach to a running one
            await MainActor.run { self.startPolling() }
        }
    }

    func applicationWillTerminate(_ note: Notification) {
        poller?.stop()
        server.stop()
    }

    // Quit when the dashboard window is closed — it's the whole app.
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool {
        true
    }

    // Re-open the window if the user clicks the Dock icon after closing it.
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window?.show() }
        return true
    }

    private func startPolling() {
        let p = SessionPoller(base: server.url)
        p.onUpdate = { [weak self] _, waiting in
            self?.notifyWaiting(waiting)
        }
        p.start()
        poller = p
    }

    private func notifyWaiting(_ waiting: [Session]) {
        let current = Set(waiting.map(\.session_key))
        for s in waiting where !notified.contains(s.session_key) {
            notify(session: s)
        }
        notified = current  // a session that waits again later re-notifies
    }

    private func notify(session: Session) {
        let content = UNMutableNotificationContent()
        content.title = "\(session.label) needs you"
        content.body = "A session is waiting on your input."
        content.sound = .default
        let req = UNNotificationRequest(
            identifier: "waiting-\(session.session_key)", content: content, trigger: nil
        )
        UNUserNotificationCenter.current().add(req)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)  // a normal app: Dock icon + windows
app.run()
