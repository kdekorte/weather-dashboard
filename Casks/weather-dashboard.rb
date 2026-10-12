cask "weather-dashboard" do
  version "1.0.8"
  sha256 "dc3e5c4cc3785bcc9df1d3b8f0647c87193a20514e14ebebba1275f09f3bdbdb"

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
