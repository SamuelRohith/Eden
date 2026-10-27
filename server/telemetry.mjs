// Local operational metrics are always available. Azure export is opt-in.
// No prompts, match text, team names, credentials, or user questions are exported.
export class Telemetry {
  constructor(){this.requests=0;this.failures=0;this.fallbacks=0;this.totalMs=0;this.exporter='local';this.last=null;}
  async initialize(config,loadSDK=async()=>{
    const {useAzureMonitor}=await import('@azure/monitor-opentelemetry');
    const {metrics}=await import('@opentelemetry/api');
    return {useAzureMonitor,metrics};
  }) {
    if(!config.cloud||!config.azure.insights)return;
    try {
      const {useAzureMonitor,metrics}=await loadSDK();
      useAzureMonitor({azureMonitorExporterOptions:{connectionString:config.azure.insights},enableLiveMetrics:false,
        instrumentationOptions:{http:{enabled:false},azureSdk:{enabled:false},mongoDb:{enabled:false},mySql:{enabled:false},postgreSql:{enabled:false},redis:{enabled:false},redis4:{enabled:false}}});
      const meter=metrics.getMeter('eden');
      this.counter=meter.createCounter('eden.story.requests');
      this.duration=meter.createHistogram('eden.story.duration',{unit:'ms'});
      this.exporter='azure_application_insights';
    }catch{this.exporter='local (Azure exporter unavailable)';}
  }
  record(result,ms) {
    this.requests++;this.totalMs+=ms;
    const provider=result?.provider||'error';
    if(provider==='error')this.failures++;
    if(result?.provider==='event_summary'||result?.notes?.some(n=>/fail|unavailable|regenerated|backup/i.test(n)))this.fallbacks++;
    this.last={provider,latencyMs:ms,at:new Date().toISOString()};
    this.counter?.add(1,{provider});this.duration?.record(ms,{provider});
  }
  snapshot(){return {requests:this.requests,failures:this.failures,fallbacks:this.fallbacks,
    averageLatencyMs:this.requests?Math.round(this.totalMs/this.requests):0,exporter:this.exporter,last:this.last};}
}
