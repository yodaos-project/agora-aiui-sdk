// Set your deployed business backend URL and supply application authentication.
// Never put AGORA_APP_CERTIFICATE or cloud vendor API keys in this agent.
export default {
  // 'agora': English / Agora Cloud. 'shengwang': Chinese / 声网 Cloud.
  // UI only; configure the matching service and pipeline in your backend.
  provider: 'agora',
  backendURL: 'https://your-voice-backend.example.com',
  // Enable after the backend sets VOICE_TOOLS_PUBLIC_URL. Actions are defined in pages/call/tools.js.
  localTools: false,
  // Use a host with echo cancellation or headphones. Otherwise use 'half-duplex'.
  microphoneMode: 'full-duplex',
  async authorization() {
    // Replace this with your application's short-lived signed-in user credential.
    // For private local testing only, return `Bearer ${your BACKEND_API_TOKEN}`.
    throw new Error('Configure application authentication in configuration.js.');
  },
};
