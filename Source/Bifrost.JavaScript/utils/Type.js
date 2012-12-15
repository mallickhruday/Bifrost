Bifrost.namespace("Bifrost", {
    Type: function () {
        var self = this;
    }
});

(function () {
    throwIfMissingTypeDefinition = function(typeDefinition) {
        if (typeDefinition == null || typeof typeDefinition == "undefined") {
            throw new Bifrost.MissingTypeDefinition();
        }
    };

    throwIfTypeDefinitionIsObjectLiteral = function(typeDefinition) {
        if (typeof typeDefinition === "object") {
            throw new Bifrost.ObjectLiteralNotAllowed();
        }
    };

    addStaticProperties = function(typeDefinition) {
        for (var property in Bifrost.Type) {
            if (Bifrost.Type.hasOwnProperty(property)) {
                typeDefinition[property] = Bifrost.Type[property];
            }
        }
    };

    setupDependencies = function(typeDefinition) {
        typeDefinition._dependencies = Bifrost.dependencyResolver.getDependenciesFor(typeDefinition);

        var firstParameter = true;
        var createFunctionString = "Function('definition', 'dependencies','return new definition(";
            
        if( typeof typeDefinition._dependencies !== "undefined" ) {
            $.each(typeDefinition._dependencies, function(index, dependency) {
                if (!firstParameter) {
                    createFunctionString += ",";
                }
                firstParameter = false;
                createFunctionString += "dependencies[" + index + "]";
            });
        }
        createFunctionString += ");')";

        typeDefinition.createFunction = eval(createFunctionString);
    };

    getDependencyInstances = function(namespace, typeDefinition) {
        var dependencyInstances = [];
        if( typeof typeDefinition._dependencies !== "undefined" ) {
            $.each(typeDefinition._dependencies, function(index, dependency) {
                var dependencyInstance = Bifrost.dependencyResolver.resolve(namespace, dependency);
                dependencyInstances.push(dependencyInstance);
            });
        }
        return dependencyInstances;
    };

    resolve = function(namespace, dependency, index, instances, typeDefinition, resolvedCallback) {
        var resolverPromise = 
            Bifrost.dependencyResolver
                .beginResolve(namespace, dependency)
                .continueWith(function(nextPromise, result) {
                    instances[index] = result;
                    resolvedCallback(nextPromise, result);
                });
    };


    beginGetDependencyInstances = function(namespace, typeDefinition) {
        var promise = Bifrost.execution.Promise.create();
        var dependencyInstances = [];
        var solvedDependencies = 0;
        if( typeof typeDefinition._dependencies !== "undefined" ) {
            var dependenciesToResolve = typeDefinition._dependencies.length;
            var actualDependencyIndex = 0;
            var dependency = "";
            for( var dependencyIndex=0; dependencyIndex<dependenciesToResolve; dependencyIndex++ ) {
                dependency = typeDefinition._dependencies[dependencyIndex];
                resolve(namespace, dependency, dependencyIndex, dependencyInstances, typeDefinition, function(nextPromise, result) {
                    solvedDependencies++;
                    if( solvedDependencies == dependenciesToResolve ) {
                        promise.signal(dependencyInstances);
                    } 
                });
            }

        }
        return promise;
    };

    expandInstancesHashToDependencies = function(typeDefinition, instanceHash, dependencyInstances) {
        for( var dependency in instanceHash ) {
            for( var dependencyIndex=0; dependencyIndex<typeDefinition._dependencies.length; dependencyIndex++ ) {
                if( typeDefinition._dependencies[dependencyIndex] == dependency ) {
                    dependencyInstances[dependencyIndex] = instanceHash[dependency];
                }
            }
        }
    };

    expandDependenciesToInstanceHash = function(typeDefinition, dependencies, instanceHash) {
        for( var dependencyIndex=0; dependencyIndex<dependencies.length; dependencyIndex++ ) {
            instanceHash[typeDefinition._dependencies[dependencyIndex]] = dependencies[dependencyIndex];
        }
    };

    Bifrost.Type.scope = {
        getFor : function(namespace, name) {
            return null;
        }
    };

    Bifrost.Type.instancesPerScope = {};


    Bifrost.Type.extend = function (typeDefinition) {
        throwIfMissingTypeDefinition(typeDefinition);
        throwIfTypeDefinitionIsObjectLiteral(typeDefinition);
        addStaticProperties(typeDefinition);
        setupDependencies(typeDefinition);
        typeDefinition._super = this;
        return typeDefinition;
    };

    Bifrost.Type.scopeTo = function(scope) {
        if( typeof scope === "function" ) {
            this.scope = {
                getFor: scope
            }
        } else {
            if( typeof scope.getFor === "function" ) {
                this.scope = scope;
            } else {
                this.scope = {
                    getFor: function() {
                        return scope;
                    }
                }
            }
        }
        return this;
    };

    Bifrost.Type.create = function (instanceHash) {
        var actualType = this;
        if( this._super != null ) {
            actualType.prototype = this._super.create();
        }
        var dependencyInstances = [];
        if( typeof instanceHash === "object" ) {
            expandInstancesHashToDependencies(this, instanceHash, dependencyInstances);
        } else {
            dependencyInstances = getDependencyInstances(this._namespace, this);
        }
        
        var scope = this.scope.getFor(this._namespace, this._name);
        if (scope != null && this.instancesPerScope.hasOwnProperty(scope)) {
            return this.instancesPerScope[scope];
        }

        var instance = null;
        if( typeof this.createFunction !== "undefined" ) {
            instance = this.createFunction(this, dependencyInstances);
        } else {
            instance = new actualType();    
        }

        if( scope != null ) {
            this.instancesPerScope[scope] = instance;
        }

        return instance;
    };

    Bifrost.Type.beginCreate = function() {
        var self = this;

        var promise = Bifrost.execution.Promise.create();
        var superPromise = Bifrost.execution.Promise.create();

        if( this._super != null ) {
            this._super.beginCreate().continueWith(function(nextPromise, _super) {
                superPromise.signal(_super);
            });
        } else {
            superPromise.signal(null);
        }

        superPromise.continueWith(function(nextPromise, _super) {
            self.prototype = _super;

            if( self._dependencies == null || 
                typeof self._dependencies == "undefined" || 
                self._dependencies.length == 0) {

                var instance = self.create();
                promise.signal(instance);
            } else {
                beginGetDependencyInstances(self._namespace, self)
                    .continueWith(function(nextPromise, dependencies) {
                        var instanceHash = {};
                        expandDependenciesToInstanceHash(self, dependencies, instanceHash);
                        var instance = self.create(instanceHash);
                        promise.signal(instance);
                    });

            }
        });

        return promise;
    };
})();