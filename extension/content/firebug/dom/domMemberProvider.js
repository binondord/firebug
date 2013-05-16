/* See license.txt for terms of usage */
/*jshint esnext:true, es5:true, curly:false */
/*global FBTrace:true, XPCNativeWrapper:true, Window:true, define:true */

define([
    "firebug/firebug",
    "firebug/lib/object",
    "firebug/lib/array",
    "firebug/lib/wrapper",
    "firebug/lib/dom",
    "firebug/lib/trace",
    "firebug/lib/locale",
    "firebug/console/closureInspector",
    "firebug/chrome/reps",
],
function(Firebug, Obj, Arr, Wrapper, Dom, FBTrace, Locale, ClosureInspector, FirebugReps) {

// ********************************************************************************************* //
// Constants

// ********************************************************************************************* //
// DOM Member Provider

function DOMMemberProvier(context)
{
    this.context = context;
}

DOMMemberProvier.prototype =
{
    /**
     * @param object a user-level object wrapped in security blanket
     * @param level for a.b.c, level is 2
     * @param optional context
     */
    getMembers: function(object, level)
    {
        if (!level)
            level = 0;

        var ordinals = [];
        var userProps = [];
        var userClasses = [];
        var userFuncs = [];
        var domProps = [];
        var domClasses = [];
        var domFuncs = [];
        var domConstants = [];
        var proto = [];
        var domHandlers = [];

        var isScope = ClosureInspector.isScopeWrapper(object);

        try
        {
            // Special case for "arguments", which is not enumerable by for...in statement.
            if (isArguments(object))
                object = Arr.cloneArray(object);

            var properties;
            var contentView = this.getObjectView(object);
            try
            {
                // Make sure not to touch the prototype chain of the magic scope objects.
                var ownOnly = Firebug.showOwnProperties || isScope;
                var enumerableOnly = Firebug.showEnumerableProperties;

                properties = this.getObjectProperties(contentView, enumerableOnly, ownOnly);
                properties = Arr.sortUnique(properties);

                var addOwn = function(prop)
                {
                    // Apparently, Object.prototype.hasOwnProperty.call(contentView, p) lies
                    // when 'contentView' is content and 'Object' is chrome... Bug 658909?
                    if (Object.getOwnPropertyDescriptor(contentView, prop) &&
                        properties.indexOf(prop) === -1)
                    {
                        properties.push(prop);
                    }
                };
                addOwn("constructor");
                addOwn("prototype");
                addOwn("wrappedJSObject");

                // __proto__ never shows in enumerations, so add it here. We currently
                // we don't want it when only showing own properties.
                if (contentView.__proto__ && Obj.hasProperties(contentView.__proto__) &&
                    properties.indexOf("__proto__") === -1 && !Firebug.showOwnProperties)
                {
                    properties.push("__proto__");
                }
            }
            catch (exc)
            {
                if (FBTrace.DBG_ERRORS || FBTrace.DBG_DOM)
                    FBTrace.sysout("dom.getMembers: property lookups failed", exc);
            }

            var name, val;
            var add = function(type, where)
            {
                this.addMember(object, type, where, name, val, level, isScope);
            }.bind(this);

            for (var i=0; i<properties.length; i++)
            {
                name = properties[i];

                // Ignore only global variables (properties of the |window| object).
                if (Wrapper.shouldIgnore(name) && (object instanceof Window))
                {
                    if (FBTrace.DBG_DOM)
                    {
                        FBTrace.sysout("dom.getMembers: Wrapper.ignoreVars: " + name + ", " +
                            level, object);
                    }
                    continue;
                }

                try
                {
                    val = contentView[name];
                }
                catch (exc)
                {
                    // Sometimes we get exceptions trying to access certain members
                    if (FBTrace.DBG_ERRORS && FBTrace.DBG_DOM)
                        FBTrace.sysout("dom.getMembers cannot access "+name, exc);

                    val = undefined;
                }

                if (!isNaN(parseInt(name, 10)))
                {
                    add("ordinal", ordinals);
                }
                else if (typeof val === "function")
                {
                    var classFunc = isClassFunction(val);
                    var domMember = Dom.isDOMMember(object, name);
                    if (domMember && classFunc)
                    {
                        add("domClass", domClasses);
                    }
                    else if (domMember)
                    {
                        add("domFunction", domFuncs);
                    }
                    else if (classFunc)
                    {
                        add("userClass", userClasses);
                    }
                    else if (!Firebug.showUserFuncs && Firebug.showInlineEventHandlers &&
                        Dom.isInlineEventHandler(name))
                    {
                        add("userFunction", domHandlers);
                    }
                    else
                    {
                        add("userFunction", userFuncs);
                    }
                }
                else
                {
                    if (isPrototype(name))
                    {
                        add("proto", proto);
                    }
                    else if (Dom.isDOMMember(object, name))
                    {
                        add("dom", domProps);
                    }
                    else if (Dom.isDOMConstant(object, name))
                    {
                        add("dom", domConstants);
                    }
                    else if (Dom.isInlineEventHandler(name))
                    {
                        add("user", domHandlers);
                    }
                    else
                    {
                        add("user", userProps);
                    }
                }
            }

            if (isScope || (typeof object === "function" && Firebug.showClosures && this.context))
            {
                this.maybeAddClosureMember(object, "proto", proto, level, isScope);
            }
        }
        catch (exc)
        {
            // Sometimes we get exceptions just from trying to iterate the members
            // of certain objects, like StorageList, but don't let that gum up the works
            if (FBTrace.DBG_DOM)
                FBTrace.sysout("dom.getMembers FAILS: ", exc);
        }

        function sortName(a, b) { return a.name > b.name ? 1 : -1; }
        function sortOrdinal(a, b) { return a.name - b.name; }

        var members = [];

        ordinals.sort(sortOrdinal);
        members.push.apply(members, ordinals);

        if (Firebug.showUserProps)
        {
            userProps.sort(sortName);
            members.push.apply(members, userProps);
        }

        if (Firebug.showUserFuncs)
        {
            userClasses.sort(sortName);
            members.push.apply(members, userClasses);

            userFuncs.sort(sortName);
            members.push.apply(members, userFuncs);
        }

        if (Firebug.showDOMProps)
        {
            domProps.sort(sortName);
            members.push.apply(members, domProps);
        }

        if (Firebug.showDOMFuncs)
        {
            domClasses.sort(sortName);
            members.push.apply(members, domClasses);

            domFuncs.sort(sortName);
            members.push.apply(members, domFuncs);
        }

        if (Firebug.showDOMConstants)
            members.push.apply(members, domConstants);

        members.push.apply(members, proto);

        if (Firebug.showInlineEventHandlers)
        {
            domHandlers.sort(sortName);
            members.push.apply(members, domHandlers);
        }

        if (FBTrace.DBG_DOM)
        {
            var showEnum = Firebug.showEnumerableProperties;
            var showOwn = Firebug.showOwnProperties;
            FBTrace.sysout("dom.getMembers; Report: enum-only: " + showEnum +
                ", own-only: " + showOwn,
            {
                object: object,
                ordinals: ordinals,
                userProps: userProps,
                userFuncs: userFuncs,
                userClasses: userClasses,
                domProps: domProps,
                domFuncs: domFuncs,
                domConstants: domConstants,
                domHandlers: domHandlers,
                proto: proto
            });
        }

        return members;
    },

    addMember: function()
    {
        try
        {
            return this.addMemberInternal.apply(this, arguments);
        }
        catch (err)
        {
            if (FBTrace.DBG_ERRORS)
                FBTrace.sysout("domPanel.addMember; EXCEPTION " + err, err);
        }
    },

    addMemberInternal: function(object, type, props, name, value, level, parentIsScope)
    {
        // Do this first in case a call to instanceof (= QI, for XPCOM things) reveals contents.
        var rep = Firebug.getRep(value);
        var tag = rep.shortTag ? rep.shortTag : rep.tag;

        var hasProperties = Obj.hasProperties(value, !Firebug.showEnumerableProperties,
            Firebug.showOwnProperties);

        var valueType = typeof value;
        var hasChildren = hasProperties && !(value instanceof FirebugReps.ErrorCopy) &&
            ((valueType === "function") ||
             (valueType === "object" && value !== null));

        // Special case for closure inspection.
        if (!hasChildren && valueType === "function" && Firebug.showClosures && this.context)
        {
            try
            {
                var win = this.context.getCurrentGlobal();
                ClosureInspector.getEnvironmentForObject(win, value, this.context);
                hasChildren = true;
            }
            catch (e) {}
        }

        // Special case for "arguments", which is not enumerable by for...in statement
        // and so, Obj.hasProperties always returns false.
        hasChildren = hasChildren || (!!value && isArguments(value));

        if (valueType === "function" && !hasChildren)
        {
            try
            {
                // Special case for functions with a prototype that has values
                var proto = value.prototype;
                if (proto)
                {
                    hasChildren = Obj.hasProperties(proto, !Firebug.showEnumerableProperties,
                        Firebug.showOwnProperties);
                }
            }
            catch (exc) {}
        }

        var descriptor = getPropertyDescriptor(object, name);

        var member = {
            object: object,
            name: name,
            value: value,
            type: type,
            rowClass: "memberRow-" + type,
            open: "",
            level: level,
            indent: level * 16,
            hasChildren: hasChildren,
            tag: tag,
            prefix: "",
            readOnly: (descriptor && !descriptor.writable && !descriptor.set),
            // XXX should probably move the tests from getContextMenuItems here
            deletable: (!parentIsScope && !(descriptor && !descriptor.configurable))
        };

        // The context doesn't have to be specified (e.g. in case of Watch panel that is based
        // on the same template as the DOM panel, but doesn't show any breakpoints).
        if (this.context)
        {
            // xxxHonza: Support for object change not implemented yet.
            member.breakable = !hasChildren && !parentIsScope;

            var breakpoints = this.context.dom.breakpoints;
            var bp = breakpoints.findBreakpoint(object, name);
            if (bp)
            {
                member.breakpoint = true;
                member.disabledBreakpoint = !bp.checked;
            }
        }

        if (parentIsScope)
            member.scopeNameTooltip = Locale.$STRF("dom.tip.scopeMemberName", ["%" + name]);

        // Set prefix for user defined properties. This prefix help the user to distinguish
        // among simple properties and those defined using getter and/or (only a) setter.
        // XXX This should be rewritten to use 'descriptor', and I believe the unwrapping
        // test is wrong (see issue 5377).
        var o = this.getObjectView(object);
        if (o && !Dom.isDOMMember(object, name) && (XPCNativeWrapper.unwrap(object) !== object))
        {
            var getter = o.__lookupGetter__(name);
            var setter = o.__lookupSetter__(name);

            // both, getter and setter
            if (getter && setter)
                member.type = "userFunction";

            // only getter
            if (getter && !setter)
            {
                member.readOnly = true;
                member.prefix = "get";
            }

            // only setter
            if (!getter && setter)
            {
                member.prefix = "set";
            }
        }

        props.push(member);
        return member;
    },

    // Add the magic "(closure)" property.
    maybeAddClosureMember: function(object, type, props, level, isScope)
    {
        var win = context.getCurrentGlobal();
        var wrapper = ClosureInspector.getScopeWrapper(object, win, this.context, isScope);
        if (!wrapper)
            return;

        var name = (isScope ? Locale.$STR("dom.scopeParentName") : Locale.$STR("dom.scopeName"));
        var title = (isScope ? undefined : Locale.$STR("dom.tip.scopeName"));
        var rep = Firebug.getRep(wrapper);
        var tag = rep.shortTag ? rep.shortTag : rep.tag;

        var member = {
            object: object,
            name: name,
            value: wrapper,
            type: type,
            rowClass: "memberRow-" + type,
            open: "",
            level: level,
            indent: level*16,
            hasChildren: true,
            tag: tag,
            prefix: "",
            title: title,
            readOnly: true,
            deletable: false,
            ignoredPath: true
        };
        props.push(member);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Object properties

    /**
     * Returns a list of properties available on an object, filtered on enumerability and prototype
     * chain position. Due to prototype traversal, some property names may appear several times.
     *
     * @param {Object} object The object we want to get the list of properties for.
     * @param {Boolean} enumerableOnly If set to true, only enumerable properties are returned.
     * @param {Boolean} ownOnly If set to true, only own properties (not those from the
     *      prototype chain) are returned.
     */
    getObjectProperties: function(object, enumerableOnly, ownOnly)
    {
        var props = [];

        // Get all enumerable-only or all-properties of the object (but not inherited).
        if (enumerableOnly)
            props = Object.keys(object);
        else
            props = Object.getOwnPropertyNames(object);

        // Not interested in inherited properties, bail out.
        if (ownOnly)
            return props;

        // Climb the prototype chain.
        var inheritedProps = [];
        var parent = Object.getPrototypeOf(object);
        if (parent)
            inheritedProps = this.getObjectProperties(parent, enumerableOnly, ownOnly);

        // Push everything onto the returned array, to avoid O(nm) runtime behavior.
        inheritedProps.push.apply(inheritedProps, props);
        return inheritedProps;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Wrappers

    getObjectView: function(object)
    {
        if (!Firebug.viewChrome)
        {
            // Unwrap native, wrapped objects.
            var contentView = Wrapper.getContentView(object);
            if (contentView)
                return contentView;
        }
        return object;
    },
}

// ********************************************************************************************* //
// Helpers

function isArguments(obj)
{
    try
    {
        return isFinite(obj.length) && obj.length > 0 && typeof obj.callee === "function";
    }
    catch (exc)
    {
    }

    return false;
}

function isClassFunction(fn)
{
    try
    {
        for (var name in fn.prototype)
            return true;
    }
    catch (exc)
    {
    }

    return false;
}

function isPrototype(name)
{
    return (name === "prototype" || name === "__proto__");
}

function getPropertyDescriptor(object, propName)
{
    try
    {
        var desc;
        while (object)
        {
            desc = Object.getOwnPropertyDescriptor(object, propName);
            if (desc)
                return desc;
            object = Object.getPrototypeOf(object);
        }
    }
    catch (e)
    {
    }
    return undefined;
}

// ********************************************************************************************* //
// Registration

return DOMMemberProvier;

// ********************************************************************************************* //
});