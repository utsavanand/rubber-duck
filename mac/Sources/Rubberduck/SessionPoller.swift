import Foundation

struct Session: Decodable {
    let session_key: String
    let state: String
    let name: String?
    let source_app: String?

    var label: String { name ?? source_app ?? String(session_key.prefix(8)) }
}

struct Counts {
    var busy = 0
    var waiting = 0
    var idle = 0

    /// Menu-bar text: "3·1" = 3 active, 1 waiting; empty when nothing's running.
    var badge: String {
        let active = busy + waiting
        if active == 0 && idle == 0 { return "" }
        return waiting > 0 ? "\(active)·\(waiting)!" : "\(active)"
    }
}

/// Polls /sessions every few seconds. Reports counts for the menu bar and the
/// set of keys currently "waiting on you" so the app can notify on new ones.
final class SessionPoller {
    private let url: URL
    private var timer: Timer?

    var onUpdate: ((Counts, [Session]) -> Void)?

    init(base: URL) {
        url = base.appendingPathComponent("sessions")
    }

    func start() {
        let t = Timer(timeInterval: 3, repeats: true) { [weak self] _ in
            Task { await self?.poll() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
        Task { await poll() }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func poll() async {
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        guard let (data, _) = try? await URLSession.shared.data(for: req),
            let wrapper = try? JSONDecoder().decode(Wrapper.self, from: data)
        else { return }
        let live = wrapper.sessions.filter { $0.state != "terminated" }
        var counts = Counts()
        for s in live {
            switch s.state {
            case "busy": counts.busy += 1
            case "waiting": counts.waiting += 1
            case "idle": counts.idle += 1
            default: break
            }
        }
        let waiting = live.filter { $0.state == "waiting" }
        await MainActor.run { self.onUpdate?(counts, waiting) }
    }

    private struct Wrapper: Decodable { let sessions: [Session] }
}
