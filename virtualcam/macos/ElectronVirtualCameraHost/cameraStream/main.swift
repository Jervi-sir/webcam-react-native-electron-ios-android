//
//  main.swift
//  cameraStream
//
//  Created by Jervi on 19/3/2026.
//

import Foundation
import CoreMediaIO

let providerSource = cameraStreamProviderSource(clientQueue: nil)
CMIOExtensionProvider.startService(provider: providerSource.provider)

CFRunLoopRun()

