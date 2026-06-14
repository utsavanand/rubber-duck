// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Rubberduck",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "Rubberduck",
            path: "Sources/Rubberduck"
        )
    ]
)
