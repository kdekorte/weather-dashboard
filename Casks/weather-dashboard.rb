cask "weather-dashboard" do
  version "1.0.2"
  sha256 "58f393f5212f48f943865233cdea3932ef23b8e44fa2396113e8624ce6181662"

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
