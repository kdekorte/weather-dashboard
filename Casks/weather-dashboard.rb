cask "weather-dashboard" do
  version "1.0.3"
  sha256 "df181e335c37d614ebb53c5a284ab74cbd0bcb5653e87a8c57a31f7d59d55da9"

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
