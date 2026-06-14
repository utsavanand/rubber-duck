import Foundation

/// Starts and stops the `rubberduck serve` process so the app owns the server's
/// lifecycle. Finds the binary on PATH (or common install dirs), spawns it, and
/// polls until the dashboard answers.
final class ServerProcess {
    let url = URL(string: "http://127.0.0.1:4200")!
    private var task: Process?

    /// Locate the `rubberduck` executable. We can't rely on a GUI app inheriting
    /// the user's shell PATH, so check the usual install locations explicitly.
    private func findBinary() -> String? {
        let candidates = [
            "/opt/homebrew/bin/rubberduck",
            "/usr/local/bin/rubberduck",
            "\(NSHomeDirectory())/.local/bin/rubberduck",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }
        // Fall back to `which` via a login shell, which sources the user's PATH.
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/bin/zsh")
        probe.arguments = ["-lc", "command -v rubberduck"]
        let pipe = Pipe()
        probe.standardOutput = pipe
        try? probe.run()
        probe.waitUntilExit()
        let out = String(
            data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let out, !out.isEmpty, FileManager.default.isExecutableFile(atPath: out) {
            return out
        }
        return nil
    }

    /// Returns true once the server is reachable. Starts it if it isn't already
    /// running (an external `rubberduck serve` is reused, not duplicated).
    func start() async -> Bool {
        if await isUp() { return true }  // someone already runs it; just attach.
        guard let bin = findBinary() else { return false }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: bin)
        proc.arguments = ["serve"]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
        } catch {
            return false
        }
        task = proc
        for _ in 0..<40 {  // up to ~8s for the server to bind
            if await isUp() { return true }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        return false
    }

    func stop() {
        task?.terminate()
        task = nil
    }

    private func isUp() async -> Bool {
        var req = URLRequest(url: url)
        req.timeoutInterval = 1
        guard let (_, resp) = try? await URLSession.shared.data(for: req),
            let http = resp as? HTTPURLResponse
        else { return false }
        return http.statusCode == 200
    }
}
