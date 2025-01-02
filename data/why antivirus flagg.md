A lot of files and applications we use to make the games enjoyable for everyone are being flagged as viruses, despite not having malicious code. So why is this?  

# Certification
The biggest reason as to why our applications and files are being flagged as malicious is because they lack a valid application signature.  
In order for us to sign our applications, we need to pay a company anywhere between $250-$800 a year for a certificate proving the authenticity of our program.  
Since we provide all of this for free, without any involuntary or voluntary income, such as donations and such, we cannot afford to pay that much for a code signing certificate.

# Methods
In order for us to be able to change your map and gamemode with Liberator, or make you able to start the game you have just downloaded, we need to employ the same methods that malware-makers usually do too. We use Windows API functions such as [OpenProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess), [WriteProcessMemory](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-writeprocessmemory), [ReadProcessMemory](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory) to name a few, which are used to modify things in the game externally. These same functions are often used by malware to do malicious things on your system, like steal or modify information in different apps, and sometimes even inject itself into other processes.