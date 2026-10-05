cask "weather-dashboard" do
  version "1.0.7"
  sha256 "81ef276ebde14c7688e02b342a85edefbefee9ee15549d90822a9329cac5296d"

  url "https://github.com/kdekorte/weather-dashboard/releases/download/v#{version}/weather-dashboard-macos-arm64-#{version}.tar.gz"
  name "Weather Dashboard"
  desc "Fullscreen kiosk-style weather dashboard built with Neutralino.js"
  homepage "https://github.com/kdekorte/weather-dashboard"

  depends_on macos: :big_sur

  app "Weather Dashboard.app"

  zap trash: [
    "~/Library/Application Support/weather-dashboard",
    "~/Library/Preferences/com.kdekorte.weather-dashboard.plist",
    "~/Library/Saved Application State/com.kdekorte.weather-dashboard.savedState",
  ]
end
