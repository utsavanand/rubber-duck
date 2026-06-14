import AppKit
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let server = ServerProcess()
    private var poller: SessionPoller?
    private var window: DashboardWindow?
    private var statusItem: NSStatusItem!
    private var countItem: NSMenuItem!
    private var notified = Set<String>()  // waiting keys we've already alerted on

    func applicationDidFinishLaunching(_ note: Notification) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "🦆"
        statusItem.menu = buildMenu()

        window = DashboardWindow(url: server.url)

        Task {
            let ok = await server.start()
            await MainActor.run {
                self.countItem.title = ok ? "Connecting…" : "Server not found — install rubberduck"
                if ok { self.startPolling() }
            }
        }
    }

    func applicationWillTerminate(_ note: Notification) {
        poller?.stop()
        server.stop()
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        countItem = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
        countItem.isEnabled = false
        menu.addItem(countItem)
        menu.addItem(.separator())
        menu.addItem(
            NSMenuItem(title: "Open dashboard", action: #selector(openDashboard), keyEquivalent: "o")
        )
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Rubberduck", action: #selector(quit), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        return menu
    }

    private func startPolling() {
        let p = SessionPoller(base: server.url)
        p.onUpdate = { [weak self] counts, waiting in
            self?.apply(counts, waiting)
        }
        p.start()
        poller = p
    }

    private func apply(_ counts: Counts, _ waiting: [Session]) {
        statusItem.button?.title = counts.badge.isEmpty ? "🦆" : "🦆 \(counts.badge)"
        countItem.title =
            "\(counts.busy) busy · \(counts.waiting) waiting · \(counts.idle) idle"

        let current = Set(waiting.map(\.session_key))
        for s in waiting where !notified.contains(s.session_key) {
            notify(session: s)
        }
        notified = current  // reset so a session that waits again re-notifies
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

    @objc private func openDashboard() { window?.show() }
    @objc private func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)  // menu-bar only — no Dock icon
app.run()
