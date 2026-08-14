import ExpoModulesCore
import AVFoundation

/// Mikrofon med EKTE ekkokansellering for Live-assistenten. Apples
/// VoiceProcessingIO (samme DSP som telefonsamtaler — og det Gemini-appen selv
/// bruker) trekker enhetens egen høyttalerlyd fra mikrofonsignalet i hardware.
/// react-native-audio-api sin recorder aktiverer aldri dette, og uten det hørte
/// serverens VAD modellens egen stemme og «avbrøt» henne midt i setninger.
/// Leverer 16 kHz mono PCM16 som base64 (klar for Live-APIets realtimeInput)
/// + RMS-nivå per chunk (driver orben).
public final class AmpexMicModule: Module {
  private var engine: AVAudioEngine?
  private var converter: AVAudioConverter?
  private var outFormat: AVAudioFormat?

  public func definition() -> ModuleDefinition {
    Name("AmpexMic")

    Events("onAudio")

    AsyncFunction("start") { (promise: Promise) in
      DispatchQueue.main.async {
        do {
          try self.startEngine()
          promise.resolve(nil)
        } catch {
          promise.reject("mic_start", error.localizedDescription)
        }
      }
    }

    Function("stop") {
      DispatchQueue.main.async { self.stopEngine() }
    }

    OnDestroy {
      DispatchQueue.main.async { self.stopEngine() }
    }
  }

  private func startEngine() throws {
    stopEngine()
    let engine = AVAudioEngine()
    // MÅ kalles før start — slår på hardware-AEC (+ støydemping/AGC) på inngangen.
    try engine.inputNode.setVoiceProcessingEnabled(true)

    let input = engine.inputNode
    let hwFormat = input.outputFormat(forBus: 0)
    guard hwFormat.sampleRate > 0,
          let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
          let converter = AVAudioConverter(from: hwFormat, to: outFormat) else {
      throw NSError(domain: "AmpexMic", code: 1, userInfo: [NSLocalizedDescriptionKey: "Uventet mikrofonformat"])
    }
    self.converter = converter
    self.outFormat = outFormat

    // ~100 ms per chunk ved 48 kHz hardware-rate.
    let bufferSize = AVAudioFrameCount(hwFormat.sampleRate / 10)
    input.installTap(onBus: 0, bufferSize: bufferSize, format: hwFormat) { [weak self] buffer, _ in
      guard let self, let conv = self.converter, let outFormat = self.outFormat else { return }
      let ratio = outFormat.sampleRate / hwFormat.sampleRate
      let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
      guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return }
      var fed = false
      var convErr: NSError?
      conv.convert(to: out, error: &convErr) { _, status in
        if fed { status.pointee = .noDataNow; return nil }
        fed = true
        status.pointee = .haveData
        return buffer
      }
      guard convErr == nil, out.frameLength > 0, let samples = out.int16ChannelData?[0] else { return }
      let count = Int(out.frameLength)
      var sum: Double = 0
      for i in 0..<count {
        let v = Double(samples[i]) / 32768.0
        sum += v * v
      }
      let rms = (sum / Double(count)).squareRoot()
      let data = Data(bytes: samples, count: count * 2)
      self.sendEvent("onAudio", ["base64": data.base64EncodedString(), "rms": rms])
    }

    engine.prepare()
    try engine.start()
    self.engine = engine
  }

  private func stopEngine() {
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
    converter = nil
    outFormat = nil
  }
}
