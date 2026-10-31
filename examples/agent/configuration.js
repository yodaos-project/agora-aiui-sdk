// Set your deployed business backend URL and supply application authentication.
// Never put AGORA_APP_CERTIFICATE or cloud vendor API keys in this agent.
export default {
  backendURL: 'https://your-voice-backend.example.com',
  // Use a host with echo cancellation or headphones. Otherwise use 'half-duplex'.
  microphoneMode: 'full-duplex',
  async authorization() {
    // Replace this with your application's short-lived signed-in user credential.
    // For private local testing only, return `Bearer ${your BACKEND_API_TOKEN}`.
    throw new Error('Configure application authentication in configuration.js.');
  },
};
